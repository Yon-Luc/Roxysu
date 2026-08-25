#include <gtk/gtk.h>
#include <glib-unix.h>
#include <gdk/wayland/gdkwayland.h>
#include <webkit/webkit.h>
#include <gtk4-layer-shell.h>
#include <wayland-client.h>

#include "foreign_toplevel.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define DEFAULT_URL "http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic"
#define DEFAULT_WIDTH 1920
#define DEFAULT_HEIGHT 1090
#define DEFAULT_MATCH_APP_ID "osu"
#define NAMESPACE "roxysu-overlay"

typedef struct {
  const char *url;
  int anchor_top;
  int anchor_left;
  int margin;
  int width;
  int height;
  double opacity;
  const char *output;
  int follow_focus;
  const char *match_app_id;
  int list_windows;
  int debug;
  const char *gsk_renderer;
  int webkit_no_dmabuf;
} Config;

typedef struct Toplevel {
  struct zwlr_foreign_toplevel_handle_v1 *handle;
  char *app_id;
  char *title;
  int activated;
  struct Toplevel *next;
} Toplevel;

typedef struct {
  struct wl_display *display;
  struct wl_event_queue *queue;
  struct zwlr_foreign_toplevel_manager_v1 *manager;
  Toplevel *toplevels;
} FocusCtx;

static Config g_cfg;
static GtkWindow *g_window = NULL;
static WebKitWebView *g_view = NULL;
static gchar *g_uri = NULL;
static guint g_load_failures = 0;
static int g_last_applied = -1;
static int g_warned_waiting = 0;
static int g_mapped = 0;
static guint g_paint_count = 0;
static struct wl_compositor *g_compositor = NULL;
static FocusCtx g_focus = {0};

static void usage(FILE *out) {
  fprintf(out,
          "roxysu-overlay — draw the Roxysu /overlay HUD above osu!lazer\n"
          "              on wlr-layer-shell Wayland compositors (Hyprland, sway, niri, ...)\n"
          "\n"
          "Usage: roxysu-overlay [options]\n"
          "  --url URL        HUD page (default %s)\n"
          "  --anchor POS     top-left | top-right | bottom-left | bottom-right (default top-right)\n"
          "  --margin PX      margin from the anchored screen edges (default 0)\n"
          "  --width PX       window width (default %d)\n"
          "  --height PX      window height (default %d)\n"
          "  --opacity F      0.05..1.0 window opacity (default 1.0)\n"
          "  --output NAME    target monitor by connector or model (default: cursor output)\n"
          "  --match-app-id S hide unless a window whose app_id (or title) contains S is focused\n"
          "                   (case-insensitive substring; default \"%s\")\n"
          "  --follow-focus B 1 = show only while the matched app is focused (default 1);\n"
          "                   0 = always visible\n"
          "  --debug          print paint-rate stats every 5s (stderr)\n"
          "  --gsk-renderer R force GTK renderer: gl | vulkan | cairo | ngl\n"
          "  --webkit-no-dmabuf   disable WebKit DMA-BUF rendering\n"
          "  --list-windows   print known windows (app_id, title, focused) and exit\n"
          "  --help\n"
          "\n"
          "The surface is always click-through. Requires the client app server (port 4321).\n",
          DEFAULT_URL, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_MATCH_APP_ID);
}

static int parse_bool(const char *s, int dflt) {
  if (strcmp(s, "1") == 0 || strcasecmp(s, "true") == 0 ||
      strcasecmp(s, "yes") == 0 || strcasecmp(s, "on") == 0)
    return 1;
  if (strcmp(s, "0") == 0 || strcasecmp(s, "false") == 0 ||
      strcasecmp(s, "no") == 0 || strcasecmp(s, "off") == 0)
    return 0;
  return dflt;
}

static void parse_args(int argc, char **argv, Config *cfg) {
  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(stdout);
      exit(0);
    } else if (strcmp(a, "--url") == 0 && i + 1 < argc) {
      cfg->url = argv[++i];
    } else if (strcmp(a, "--margin") == 0 && i + 1 < argc) {
      cfg->margin = atoi(argv[++i]);
    } else if (strcmp(a, "--width") == 0 && i + 1 < argc) {
      cfg->width = atoi(argv[++i]);
    } else if (strcmp(a, "--height") == 0 && i + 1 < argc) {
      cfg->height = atoi(argv[++i]);
    } else if (strcmp(a, "--opacity") == 0 && i + 1 < argc) {
      cfg->opacity = g_ascii_strtod(argv[++i], NULL);
    } else if (strcmp(a, "--output") == 0 && i + 1 < argc) {
      cfg->output = argv[++i];
    } else if (strcmp(a, "--match-app-id") == 0 && i + 1 < argc) {
      cfg->match_app_id = argv[++i];
    } else if (strcmp(a, "--follow-focus") == 0 && i + 1 < argc) {
      cfg->follow_focus = parse_bool(argv[++i], cfg->follow_focus);
    } else if (strcmp(a, "--list-windows") == 0) {
      cfg->list_windows = 1;
    } else if (strcmp(a, "--debug") == 0) {
      cfg->debug = 1;
    } else if (strcmp(a, "--gsk-renderer") == 0 && i + 1 < argc) {
      cfg->gsk_renderer = argv[++i];
    } else if (strcmp(a, "--webkit-no-dmabuf") == 0) {
      cfg->webkit_no_dmabuf = 1;
    } else if (strcmp(a, "--anchor") == 0 && i + 1 < argc) {
      const char *pos = argv[++i];
      if (strcmp(pos, "top-left") == 0) {
        cfg->anchor_top = 1;
        cfg->anchor_left = 1;
      } else if (strcmp(pos, "top-right") == 0) {
        cfg->anchor_top = 1;
        cfg->anchor_left = 0;
      } else if (strcmp(pos, "bottom-left") == 0) {
        cfg->anchor_top = 0;
        cfg->anchor_left = 1;
      } else if (strcmp(pos, "bottom-right") == 0) {
        cfg->anchor_top = 0;
        cfg->anchor_left = 0;
      } else {
        fprintf(stderr, "roxysu-overlay: unknown --anchor '%s'\n", pos);
        exit(2);
      }
    } else {
      fprintf(stderr, "roxysu-overlay: unknown or incomplete option '%s'\n", a);
      usage(stderr);
      exit(2);
    }
  }

  if (cfg->width <= 0) cfg->width = DEFAULT_WIDTH;
  if (cfg->height <= 0) cfg->height = DEFAULT_HEIGHT;
  if (!(cfg->opacity > 0.0 && cfg->opacity <= 1.0)) cfg->opacity = 1.0;
}

static const char *ci_strstr(const char *haystack, const char *needle) {
  size_t nl = strlen(needle);
  if (nl == 0) return haystack;
  for (; *haystack; haystack++) {
    if (strncasecmp(haystack, needle, nl) == 0) return haystack;
  }
  return NULL;
}

static int toplevel_matches(const Toplevel *tl) {
  if (tl->app_id != NULL && *tl->app_id != 0 &&
      ci_strstr(tl->app_id, g_cfg.match_app_id) != NULL)
    return 1;
  if ((tl->app_id == NULL || *tl->app_id == 0) && tl->title != NULL &&
      ci_strstr(tl->title, g_cfg.match_app_id) != NULL)
    return 1;
  return 0;
}

static void registry_handle_global(void *data, struct wl_registry *registry,
                                   uint32_t name, const char *interface,
                                   uint32_t version) {
  (void)version;
  struct wl_compositor **out = data;
  if (strcmp(interface, wl_compositor_interface.name) == 0 && *out == NULL) {
    *out = wl_registry_bind(registry, name, &wl_compositor_interface, 1);
  }
}

static void registry_handle_global_remove(void *data,
                                          struct wl_registry *registry,
                                          uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener registry_listener = {
    .global = registry_handle_global,
    .global_remove = registry_handle_global_remove,
};

static void bind_compositor(GdkDisplay *display) {
  struct wl_display *wl = gdk_wayland_display_get_wl_display(display);
  struct wl_registry *registry = wl_display_get_registry(wl);
  wl_registry_add_listener(registry, &registry_listener, &g_compositor);
  wl_display_roundtrip(wl);
}

static void apply_click_through(GtkWidget *widget, gpointer user_data) {
  (void)user_data;
  GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(widget));
  if (surface == NULL || !GDK_IS_WAYLAND_SURFACE(surface) ||
      g_compositor == NULL)
    return;

  struct wl_surface *ws = gdk_wayland_surface_get_wl_surface(surface);
  struct wl_region *empty = wl_compositor_create_region(g_compositor);
  if (ws != NULL && empty != NULL) wl_surface_set_input_region(ws, empty);
  if (empty != NULL) wl_region_destroy(empty);
}

static GdkMonitor *find_monitor_by_name(GdkDisplay *display, const char *name) {
  GListModel *monitors = gdk_display_get_monitors(display);
  guint n = g_list_model_get_n_items(monitors);
  for (guint i = 0; i < n; i++) {
    GdkMonitor *m = g_list_model_get_item(monitors, i);
    const char *connector = gdk_monitor_get_connector(m);
    const char *model = gdk_monitor_get_model(m);
    if ((connector != NULL && strcasecmp(connector, name) == 0) ||
        (model != NULL && strcasecmp(model, name) == 0))
      return m;
    g_object_unref(m);
  }
  return NULL;
}

static void list_outputs(GdkDisplay *display) {
  GListModel *monitors = gdk_display_get_monitors(display);
  guint n = g_list_model_get_n_items(monitors);
  fprintf(stderr, "roxysu-overlay: available outputs:\n");
  for (guint i = 0; i < n; i++) {
    GdkMonitor *m = g_list_model_get_item(monitors, i);
    fprintf(stderr, "  %s (%s)\n", gdk_monitor_get_connector(m),
            gdk_monitor_get_model(m));
    g_object_unref(m);
  }
}

static void set_page_hidden(int hidden) {
  const char *js = hidden
      ? "document.documentElement.style.visibility='hidden';"
      : "document.documentElement.style.visibility='visible';";
  webkit_web_view_evaluate_javascript(g_view, js, -1, NULL, "roxysu-overlay",
                                      NULL, NULL, NULL);
}

static void inject_keepalive(void) {
  const char *js =
      "(function(){"
      "if(document.getElementById('roxysu-keepalive'))return;"
      "var s=document.createElement('style');s.id='roxysu-keepalive';"
      "s.textContent='@keyframes roxsyuKa{from{opacity:.99998}to{opacity:1}}"
      "html{animation:roxsyuKa .2s linear infinite alternate}';"
      "document.head.appendChild(s);})();";
  webkit_web_view_evaluate_javascript(g_view, js, -1, NULL, "roxysu-overlay",
                                      NULL, NULL, NULL);
}

static void apply_visibility(int visible) {
  if (g_window == NULL || g_view == NULL || g_cfg.follow_focus == 0) return;
  if (g_last_applied == visible) return;

  if (visible && !g_mapped) {
    gtk_window_present(g_window);
    gtk_layer_set_layer(g_window, GTK_LAYER_SHELL_LAYER_TOP);
    gtk_layer_set_layer(g_window, GTK_LAYER_SHELL_LAYER_OVERLAY);
    gtk_widget_queue_draw(GTK_WIDGET(g_view));
    set_page_hidden(0);
    inject_keepalive();
    g_mapped = 1;
  } else if (!visible && g_mapped) {
    set_page_hidden(1);
    gtk_widget_set_visible(GTK_WIDGET(g_window), FALSE);
    g_mapped = 0;
  }

  fprintf(stderr, "roxysu-overlay: %s (%s focused)\n",
          visible ? "shown" : "hidden",
          g_cfg.match_app_id);
  g_last_applied = visible;
}

static gboolean damage_tick(gpointer data) {
  (void)data;
  if (!g_mapped || g_last_applied != 1 || g_window == NULL || g_view == NULL)
    return G_SOURCE_CONTINUE;

  static int flip = 0;
  flip ^= 1;
  gtk_widget_set_opacity(GTK_WIDGET(g_view), flip ? 1.0 : 0.999);

  GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(g_window));
  GdkFrameClock *clock = surface ? gdk_surface_get_frame_clock(surface) : NULL;
  gtk_widget_queue_draw(GTK_WIDGET(g_view));
  if (clock != NULL)
    gdk_frame_clock_request_phase(clock, GDK_FRAME_CLOCK_PHASE_PAINT);
  return G_SOURCE_CONTINUE;
}

static gboolean paint_counter(GtkWidget *widget, GdkFrameClock *clock,
                              gpointer data) {
  (void)widget;
  (void)data;
  (void)clock;
  g_paint_count++;
  return G_SOURCE_CONTINUE;
}

static gboolean debug_report(gpointer data) {
  (void)data;
  fprintf(stderr, "roxysu-overlay: paints/5s=%u mapped=%d shown=%d\n",
          g_paint_count, g_mapped, g_last_applied);
  g_paint_count = 0;
  return G_SOURCE_CONTINUE;
}

static gboolean reload_uri_cb(gpointer data) {
  WebKitWebView *view = WEBKIT_WEB_VIEW(data);
  if (g_uri != NULL) webkit_web_view_load_uri(view, g_uri);
  return G_SOURCE_REMOVE;
}

static void on_web_process_terminated(WebKitWebView *view,
                                      WebKitWebProcessTerminationReason reason,
                                      gpointer data) {
  (void)view;
  (void)data;
  fprintf(stderr,
          "roxysu-overlay: web process %s — reloading in 1s\n",
          reason == WEBKIT_WEB_PROCESS_CRASHED ? "crashed"
                                                : "hit its memory limit");
  g_timeout_add(1000, reload_uri_cb, g_view);
}

static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent event,
                               gchar *failing_uri, GError *error,
                               gpointer data) {
  (void)view;
  (void)event;
  (void)failing_uri;
  (void)data;
  g_load_failures++;
  const guint delay = g_load_failures > 5 ? 15000 : 3000;
  fprintf(stderr, "roxysu-overlay: load failed (%s) — retrying in %ums\n",
          error != NULL && error->message != NULL ? error->message : "unknown",
          delay);
  g_timeout_add(delay, reload_uri_cb, g_view);
  return TRUE;
}

static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event,
                            gpointer data) {
  (void)view;
  (void)data;
  if (event == WEBKIT_LOAD_FINISHED) g_load_failures = 0;
}

static void recompute_focus(void) {
  if (g_cfg.follow_focus == 0) return;

  int any_match = 0;
  int match_focused = 0;
  for (Toplevel *tl = g_focus.toplevels; tl != NULL; tl = tl->next) {
    if (!toplevel_matches(tl)) continue;
    any_match = 1;
    if (tl->activated) match_focused = 1;
  }

  if (!any_match) {
    if (!g_warned_waiting) {
      fprintf(stderr, "roxysu-overlay: waiting for a focused window matching "
                      "'%s' (see --match-app-id, --list-windows)\n",
              g_cfg.match_app_id);
      g_warned_waiting = 1;
    }
  } else {
    g_warned_waiting = 0;
  }

  apply_visibility(match_focused);
}

static void toplevel_destroy(Toplevel *tl) {
  if (tl->handle != NULL)
    zwlr_foreign_toplevel_handle_v1_destroy(tl->handle);
  free(tl->app_id);
  free(tl->title);
  free(tl);
}

static void ft_handle_title(void *data,
                            struct zwlr_foreign_toplevel_handle_v1 *h,
                            const char *title) {
  Toplevel *tl = data;
  (void)h;
  free(tl->title);
  tl->title = strdup(title);
}

static void ft_handle_app_id(void *data,
                             struct zwlr_foreign_toplevel_handle_v1 *h,
                             const char *app_id) {
  Toplevel *tl = data;
  (void)h;
  free(tl->app_id);
  tl->app_id = strdup(app_id);
}

static void ft_handle_output_enter(void *data,
                                   struct zwlr_foreign_toplevel_handle_v1 *h,
                                   struct wl_output *output) {
  (void)data;
  (void)h;
  (void)output;
}

static void ft_handle_output_leave(void *data,
                                   struct zwlr_foreign_toplevel_handle_v1 *h,
                                   struct wl_output *output) {
  (void)data;
  (void)h;
  (void)output;
}

static void ft_handle_state(void *data,
                            struct zwlr_foreign_toplevel_handle_v1 *h,
                            struct wl_array *states) {
  Toplevel *tl = data;
  (void)h;
  tl->activated = 0;
  uint32_t *it;
  wl_array_for_each(it, states) {
    if (*it == ZWLR_FOREIGN_TOPLEVEL_HANDLE_V1_STATE_ACTIVATED)
      tl->activated = 1;
  }
}

static void ft_handle_done(void *data,
                           struct zwlr_foreign_toplevel_handle_v1 *h) {
  (void)data;
  (void)h;
  recompute_focus();
}

static void ft_handle_closed(void *data,
                             struct zwlr_foreign_toplevel_handle_v1 *h) {
  Toplevel *tl = data;
  (void)h;
  Toplevel **link = &g_focus.toplevels;
  while (*link != NULL && *link != tl) link = &(*link)->next;
  if (*link == tl) *link = tl->next;
  toplevel_destroy(tl);
  recompute_focus();
}

static const struct zwlr_foreign_toplevel_handle_v1_listener
    ft_handle_listener = {
        .title = ft_handle_title,
        .app_id = ft_handle_app_id,
        .output_enter = ft_handle_output_enter,
        .output_leave = ft_handle_output_leave,
        .state = ft_handle_state,
        .done = ft_handle_done,
        .closed = ft_handle_closed,
};

static void ft_manager_toplevel(
    void *data, struct zwlr_foreign_toplevel_manager_v1 *manager,
    struct zwlr_foreign_toplevel_handle_v1 *handle) {
  FocusCtx *ctx = data;
  (void)manager;
  Toplevel *tl = calloc(1, sizeof(Toplevel));
  tl->handle = handle;
  tl->next = ctx->toplevels;
  ctx->toplevels = tl;
  zwlr_foreign_toplevel_handle_v1_add_listener(handle, &ft_handle_listener, tl);
}

static void ft_manager_finished(
    void *data, struct zwlr_foreign_toplevel_manager_v1 *manager) {
  (void)data;
  (void)manager;
}

static const struct zwlr_foreign_toplevel_manager_v1_listener
    ft_manager_listener = {
        .toplevel = ft_manager_toplevel,
        .finished = ft_manager_finished,
};

static void ft_registry_global(void *data, struct wl_registry *reg,
                               uint32_t name, const char *interface,
                               uint32_t version) {
  FocusCtx *ctx = data;
  if (strcmp(interface, zwlr_foreign_toplevel_manager_v1_interface.name) != 0)
    return;
  uint32_t bound = version < 1 ? 1 : (version > 2 ? 2 : version);
  struct wl_proxy *wrapper = wl_proxy_create_wrapper((struct wl_proxy *)reg);
  wl_proxy_set_queue(wrapper, ctx->queue);
  ctx->manager = wl_registry_bind(
      reg, name, &zwlr_foreign_toplevel_manager_v1_interface, bound);
  wl_proxy_wrapper_destroy(wrapper);
  if (ctx->manager != NULL)
    zwlr_foreign_toplevel_manager_v1_add_listener(
        ctx->manager, &ft_manager_listener, ctx);
}

static void ft_registry_global_remove(void *data, struct wl_registry *reg,
                                      uint32_t name) {
  (void)data;
  (void)reg;
  (void)name;
}

static const struct wl_registry_listener ft_registry_listener = {
    .global = ft_registry_global,
    .global_remove = ft_registry_global_remove,
};

static gboolean on_wayland_readable(gint fd, GIOCondition cond, gpointer data) {
  (void)fd;
  (void)data;
  if (cond & (G_IO_ERR | G_IO_HUP)) return G_SOURCE_REMOVE;
  if (wl_display_dispatch_queue(g_focus.display, g_focus.queue) < 0) {
    fprintf(stderr, "roxysu-overlay: wayland focus connection failed\n");
    return G_SOURCE_REMOVE;
  }
  return G_SOURCE_CONTINUE;
}

static int ft_print_windows(void) {
  if (g_focus.toplevels == NULL) {
    fprintf(stderr, "roxysu-overlay: no windows reported by the compositor\n");
    return 0;
  }
  fprintf(stderr, "roxysu-overlay: known windows (focused=*):\n");
  for (Toplevel *tl = g_focus.toplevels; tl != NULL; tl = tl->next) {
    fprintf(stderr, "  %s app_id='%s' title='%s'\n",
            tl->activated ? "*" : " ",
            tl->app_id ? tl->app_id : "",
            tl->title ? tl->title : "");
  }
  return 0;
}

static int ft_init(GdkDisplay *display, Config *cfg) {
  struct wl_display *wl = gdk_wayland_display_get_wl_display(display);
  g_focus.display = wl;
  g_focus.queue = wl_display_create_queue(wl);

  struct wl_proxy *dwrap = wl_proxy_create_wrapper((struct wl_proxy *)wl);
  wl_proxy_set_queue(dwrap, g_focus.queue);
  struct wl_registry *reg = wl_display_get_registry((struct wl_display *)dwrap);
  wl_proxy_wrapper_destroy(dwrap);
  if (reg == NULL) return 0;
  wl_registry_add_listener(reg, &ft_registry_listener, &g_focus);

  wl_display_roundtrip_queue(wl, g_focus.queue);
  wl_display_roundtrip_queue(wl, g_focus.queue);

  if (g_focus.manager == NULL) return 0;

  if (cfg->list_windows) return ft_print_windows();

  g_unix_fd_add(wl_display_get_fd(wl), G_IO_IN | G_IO_ERR | G_IO_HUP,
                on_wayland_readable, NULL);
  recompute_focus();
  return 1;
}

#define WATCHDOG_INTERVAL_SEC 20
#define WATCHDOG_MAX_AGE_SEC 1800
#define WATCHDOG_MAX_FDS 450
#define WATCHDOG_MAX_RSS_MB 4200

typedef struct {
  pid_t pid;
  pid_t ppid;
  unsigned long rss_kb;
  int marked;
} ProcSnap;

static time_t g_started_at;

static long env_long(const char *key, long fallback) {
  const gchar *v = g_getenv(key);
  return v != NULL ? atol(v) : fallback;
}

static unsigned long proc_rss_kb(pid_t pid) {
  gchar *path = g_strdup_printf("/proc/%d/statm", (int)pid);
  FILE *f = fopen(path, "r");
  g_free(path);
  if (f == NULL)
    return 0;
  unsigned long total_pages = 0, rss_pages = 0;
  if (fscanf(f, "%lu %lu", &total_pages, &rss_pages) != 2)
    rss_pages = 0;
  fclose(f);
  return rss_pages * ((unsigned long)sysconf(_SC_PAGESIZE) / 1024);
}

static guint proc_fd_count(pid_t pid) {
  gchar *path = g_strdup_printf("/proc/%d/fd", (int)pid);
  GDir *d = g_dir_open(path, 0, NULL);
  guint n = 0;
  if (d != NULL) {
    while (g_dir_read_name(d) != NULL)
      n++;
    g_dir_close(d);
  }
  g_free(path);
  return n;
}

static gboolean resource_watchdog(gpointer data) {
  (void)data;
  GDir *dir = g_dir_open("/proc", 0, NULL);
  if (dir == NULL)
    return G_SOURCE_CONTINUE;
  GArray *procs = g_array_new(FALSE, FALSE, sizeof(ProcSnap));
  const gchar *name;
  while ((name = g_dir_read_name(dir)) != NULL) {
    gchar *end;
    long v = strtol(name, &end, 10);
    if (end == name || *end != '\0' || v <= 0)
      continue;
    ProcSnap ps = {.pid = (pid_t)v, .ppid = 0, .rss_kb = 0, .marked = 0};
    gchar *stat_path = g_strdup_printf("/proc/%d/stat", (int)ps.pid);
    gchar *raw = NULL;
    if (g_file_get_contents(stat_path, &raw, NULL, NULL)) {
      char *rp = strrchr(raw, ')');
      char state;
      int ppid = 0;
      if (rp != NULL && sscanf(rp + 1, " %c %d", &state, &ppid) == 2)
        ps.ppid = (pid_t)ppid;
      g_free(raw);
    }
    g_free(stat_path);
    ps.rss_kb = proc_rss_kb(ps.pid);
    g_array_append_val(procs, ps);
  }
  g_dir_close(dir);

  pid_t self = getpid();
  int progressed = TRUE;
  while (progressed) {
    progressed = FALSE;
    for (guint i = 0; i < procs->len; i++) {
      ProcSnap *ps = &g_array_index(procs, ProcSnap, i);
      if (ps->marked)
        continue;
      if (ps->ppid == self) {
        ps->marked = 1;
        progressed = TRUE;
        continue;
      }
      for (guint j = 0; j < procs->len; j++) {
        ProcSnap *cand = &g_array_index(procs, ProcSnap, j);
        if (cand->marked && cand->pid == ps->ppid) {
          ps->marked = 1;
          progressed = TRUE;
          break;
        }
      }
    }
  }

  unsigned long total_kb = 0;
  guint max_fds = 0;
  for (guint i = 0; i < procs->len; i++) {
    ProcSnap *ps = &g_array_index(procs, ProcSnap, i);
    if (!ps->marked)
      continue;
    total_kb += ps->rss_kb;
    guint fc = proc_fd_count(ps->pid);
    if (fc > max_fds)
      max_fds = fc;
  }
  g_array_unref(procs);

  time_t age = time(NULL) - g_started_at;
  unsigned long total_mb = total_kb / 1024;
  const char *reason = NULL;
  long age_cap = env_long("ROXYSU_WATCHDOG_MAX_AGE_SEC", WATCHDOG_MAX_AGE_SEC);
  long fd_cap = env_long("ROXYSU_WATCHDOG_MAX_FDS", WATCHDOG_MAX_FDS);
  long rss_cap = env_long("ROXYSU_WATCHDOG_MAX_RSS_MB", WATCHDOG_MAX_RSS_MB);
  if (age > age_cap)
    reason = "max age";
  else if ((long)max_fds > fd_cap)
    reason = "descendant fd cap";
  else if ((long)total_mb > rss_cap)
    reason = "tree rss cap";
  if (reason != NULL) {
    fprintf(stderr,
            "roxysu-overlay: watchdog: %s exceeded (age=%lds tree_rss=%luMB"
            " max_fds=%u) — exiting for clean respawn\n",
            reason, (long)age, total_mb, max_fds);
    exit(0);
  }
  return G_SOURCE_CONTINUE;
}

int main(int argc, char **argv) {
  Config cfg = {
      .url = DEFAULT_URL,
      .anchor_top = 1,
      .anchor_left = 0,
      .margin = 0,
      .width = DEFAULT_WIDTH,
      .height = DEFAULT_HEIGHT,
      .opacity = 1.0,
      .output = NULL,
      .follow_focus = 1,
      .match_app_id = DEFAULT_MATCH_APP_ID,
      .list_windows = 0,
      .debug = 0,
      .gsk_renderer = NULL,
      .webkit_no_dmabuf = 0,
  };
  static char key_storage[128][256];
  static char *expanded[256];
  int eargc = 0;
  expanded[eargc++] = (char *)"roxysu-overlay";
  for (int i = 1; i < argc && eargc < 253; i++) {
    char *eq = strchr(argv[i], '=');
    if (eq == NULL) {
      expanded[eargc++] = argv[i];
      continue;
    }
    size_t keylen = (size_t)(eq - argv[i]);
    if (keylen >= sizeof(key_storage[0])) continue;
    char *key = key_storage[eargc];
    memcpy(key, argv[i], keylen);
    key[keylen] = '\0';
    expanded[eargc++] = key;
    expanded[eargc++] = eq + 1;
  }
  parse_args(eargc, expanded, &cfg);
  g_cfg = cfg;

  if (cfg.gsk_renderer != NULL)
    g_setenv("GSK_RENDERER", cfg.gsk_renderer, TRUE);
  if (cfg.webkit_no_dmabuf)
    g_setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", TRUE);

  gtk_init();

  GdkDisplay *display = gdk_display_get_default();
  if (!GDK_IS_WAYLAND_DISPLAY(display)) {
    fprintf(stderr,
            "roxysu-overlay: no Wayland display detected.\n"
            "This host is wlroots-Wayland only; on X11 use the same HUD as an\n"
            "OBS browser source or a normal browser window instead:\n"
            "  %s\n",
            cfg.url);
    return 1;
  }

  if (!gtk_layer_is_supported()) {
    fprintf(stderr,
            "roxysu-overlay: compositor does not support zwlr_layer_shell_v1.\n"
            "Use a wlroots-family compositor (Hyprland, sway, niri, river, KDE).\n");
    return 1;
  }

  bind_compositor(display);

  GtkCssProvider *css = gtk_css_provider_new();
  gtk_css_provider_load_from_string(
      css, "window { background: transparent; } webview { background: transparent; }");
  gtk_style_context_add_provider_for_display(
      display, GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(css);

  GtkWindow *window = GTK_WINDOW(gtk_window_new());
  g_window = window;
  gtk_window_set_title(window, "Roxysu overlay");
  gtk_window_set_default_size(window, cfg.width, cfg.height);
  gtk_widget_set_opacity(GTK_WIDGET(window), cfg.opacity);

  gtk_layer_init_for_window(window);
  gtk_layer_set_layer(window, GTK_LAYER_SHELL_LAYER_OVERLAY);
  gtk_layer_set_namespace(window, NAMESPACE);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_TOP, cfg.anchor_top);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_BOTTOM, !cfg.anchor_top);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_LEFT, cfg.anchor_left);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_RIGHT, !cfg.anchor_left);
  gtk_layer_set_margin(window, GTK_LAYER_SHELL_EDGE_TOP, cfg.margin);
  gtk_layer_set_margin(window, GTK_LAYER_SHELL_EDGE_BOTTOM, cfg.margin);
  gtk_layer_set_margin(window, GTK_LAYER_SHELL_EDGE_LEFT, cfg.margin);
  gtk_layer_set_margin(window, GTK_LAYER_SHELL_EDGE_RIGHT, cfg.margin);
  gtk_layer_set_exclusive_zone(window, -1);
  gtk_layer_set_keyboard_mode(window, GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);

  if (cfg.output != NULL) {
    GdkMonitor *monitor = find_monitor_by_name(display, cfg.output);
    if (monitor == NULL) {
      fprintf(stderr, "roxysu-overlay: no output matches '%s'\n", cfg.output);
      list_outputs(display);
      return 2;
    }
    gtk_layer_set_monitor(window, monitor);
  }

  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  g_view = view;
  g_uri = g_strdup(cfg.url);
  GdkRGBA transparent = {0.0, 0.0, 0.0, 0.0};
  webkit_web_view_set_background_color(view, &transparent);
  webkit_web_view_load_uri(view, cfg.url);
  gtk_window_set_child(window, GTK_WIDGET(view));

  // Self-heal: a dead web process (OOM, GPU/DMA-BUF crash) leaves the last
  // frame on screen forever — reload instead.
  g_signal_connect(view, "web-process-terminated",
                   G_CALLBACK(on_web_process_terminated), NULL);
  g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), NULL);
  g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), NULL);

  g_signal_connect(window, "map", G_CALLBACK(apply_click_through), NULL);

  int focus_ok = ft_init(display, &cfg);
  if (cfg.list_windows) {
    if (!focus_ok)
      fprintf(stderr,
              "roxysu-overlay: compositor lacks zwlr_foreign_toplevel_management\n");
    return focus_ok ? 0 : 1;
  }

  gtk_widget_add_tick_callback(GTK_WIDGET(view), paint_counter, NULL, NULL);

  if (cfg.follow_focus == 0 || !focus_ok) {
    if (!focus_ok && cfg.follow_focus == 1)
      fprintf(stderr,
              "roxysu-overlay: compositor lacks zwlr_foreign_toplevel_management;"
              " focus following disabled, staying always visible\n");
    gtk_window_present(window);
  } else {
    g_timeout_add(300, damage_tick, NULL);
  }
  if (cfg.debug) g_timeout_add(5000, debug_report, NULL);
  g_started_at = time(NULL);
  g_timeout_add_seconds(WATCHDOG_INTERVAL_SEC, resource_watchdog, NULL);

  GMainLoop *loop = g_main_loop_new(NULL, FALSE);
  g_main_loop_run(loop);
  g_main_loop_unref(loop);
  return 0;
}
