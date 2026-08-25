{
  lib,
  stdenv,
  autoPatchelfHook,
  pkg-config,
  wayland-scanner,
  wlr-protocols,
  wayland,
  gtk4,
  webkitgtk_6_0,
  gtk4-layer-shell,
  version,
}: let
  pname = "roxysu-overlay";
in
  # In-game overlay host built from apps/overlay/main.c: a GTK4 +
  # gtk4-layer-shell + WebKitGTK Wayland client that draws the /#/overlay HUD
  # above fullscreen osu!lazer on wlr-layer-shell compositors. Data comes only
  # from client-app HTTP (GET /api/overlay) — see features/in-game-overlay.
  stdenv.mkDerivation {
    inherit pname version;

    src = ../apps/overlay;

    nativeBuildInputs = [
      autoPatchelfHook
      pkg-config
      wayland-scanner
    ];
    # autoPatchelf bakes absolute store RPATHs into the binary at fixup, so
    # consumers (nix/prebuilt.nix, nix/package.nix) can copy it into resources
    # without pulling GTK/WebKit into their own closure.
    buildInputs = [
      wayland
      gtk4
      webkitgtk_6_0
      gtk4-layer-shell
    ];

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/bin"
      install -m755 roxysu-overlay "$out/bin/roxysu-overlay"
      runHook postInstall
    '';

    buildPhase = ''
      runHook preBuild
      xml="${wlr-protocols}/share/wlr-protocols/unstable/wlr-foreign-toplevel-management-unstable-v1.xml"
      test -f "$xml"
      mkdir -p gen
      wayland-scanner client-header "$xml" gen/foreign_toplevel.h
      wayland-scanner private-code "$xml" gen/foreign_toplevel.c
      cc -O2 -Wall -Wextra -Igen -o roxysu-overlay main.c gen/foreign_toplevel.c \
        $(pkg-config --cflags --libs gtk4 webkitgtk-6.0 gtk4-layer-shell-0 wayland-client)
      runHook postBuild
    '';

    meta = {
      description = "Roxysu in-game overlay host (Wayland wlr-layer-shell + WebKitGTK)";
      license = lib.licenses.mit;
      platforms = ["x86_64-linux"];
      mainProgram = pname;
    };
  }
