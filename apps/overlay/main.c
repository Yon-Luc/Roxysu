#include <gtk/gtk.h>
#include <gdk/wayland/gdkwayland.h>
#include <webkit/webkit.h>
#include <gtk4-layer-shell.h>
#include <wayland-client.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#define DEFAULT_URL "http://127.0.0.1:4321/#/overlay?limit=8&bg=clear"
#define DEFAULT_WIDTH 460
#define DEFAULT_HEIGHT 640
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
} Config;

static struct wl_compositor *g_compositor = NULL;

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
          "  --help\n"
          "\n"
          "The surface is always click-through; close it with Ctrl+C in its terminal.\n"
          "Requires the client app server running (default port 4321).\n",
          DEFAULT_URL, DEFAULT_WIDTH, DEFAULT_HEIGHT);
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
  };
  parse_args(argc, argv, &cfg);

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
  gtk_window_set_title(window, "Roxysu overlay");
  gtk_window_set_default_size(window, cfg.width, cfg.height);
  gtk_widget_set_opacity(GTK_WIDGET(window), cfg.opacity);

  gtk_layer_init_for_window(window);
  gtk_layer_set_layer(window, GTK_LAYER_SHELL_LAYER_OVERLAY);
  gtk_layer_set_namespace(window, NAMESPACE);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_TOP,
                              cfg.anchor_top);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_BOTTOM,
                              !cfg.anchor_top);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_LEFT,
                              cfg.anchor_left);
  gtk_layer_set_anchor(window, GTK_LAYER_SHELL_EDGE_RIGHT,
                              !cfg.anchor_left);
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
  GdkRGBA transparent = {0.0, 0.0, 0.0, 0.0};
  webkit_web_view_set_background_color(view, &transparent);
  webkit_web_view_load_uri(view, cfg.url);

  GtkWidget *area = gtk_window_get_child(window);
  if (area != NULL) gtk_window_set_child(window, NULL);
  gtk_window_set_child(window, GTK_WIDGET(view));

  g_signal_connect(window, "map", G_CALLBACK(apply_click_through), NULL);

  gtk_window_present(window);
  GMainLoop *loop = g_main_loop_new(NULL, FALSE);
  g_main_loop_run(loop);
  g_main_loop_unref(loop);
  return 0;
}
