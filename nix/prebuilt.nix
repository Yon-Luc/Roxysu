{
  lib,
  stdenv,
  autoPatchelfHook,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  electron,
  # CI builds native addons for Node 22. nodejs_24 cannot load them.
  nodejs_22,
  zlib,
  openssl,
  icu,
  # In-game overlay host derivation (nix/overlay-rs.nix); null skips bundling.
  overlayBin ? null,
  # Path to the unpacked `roxysu/` app root (main.js, resources/, …).
  src,
  version,
}: let
  pname = "roxysu";

  nativeLibs = [
    stdenv.cc.cc
    zlib
    openssl
    icu
  ];

  # Child processes (server, realm-reader) get this path only. Electron's own
  # wrapper path stays on the parent so Chromium libs are not inherited.
  libraryPath = lib.makeLibraryPath nativeLibs;

  desktopItem = makeDesktopItem {
    name = pname;
    desktopName = "Roxysu";
    genericName = "osu! Practice Companion";
    comment = "Practice companion for osu!";
    exec = pname;
    icon = pname;
    categories = ["Game" "Utility"];
    terminal = false;
    startupNotify = true;
    startupWMClass = "Roxysu";
  };
in
  stdenv.mkDerivation {
    inherit pname version src;

    nativeBuildInputs = [
      autoPatchelfHook
      makeWrapper
      copyDesktopItems
    ];

    buildInputs = nativeLibs;
    desktopItems = [desktopItem];

    # Native .node addons + the unused nodejs.org binary break if strip runs on them.
    dontStrip = true;

    # nodejs.org Node embeds a V8 startup snapshot at a fixed file offset.
    # autoPatchelf rewrites ELF segments and that binary SIGSEGVs on startup.
    # This nixpkgs has no file-ignore list, so the binary leaves $out for the
    # hook and is restored afterwards. It is not executed — see ROXYSU_NODE_BIN.
    # The implicit postFixup attribute runs *before* postFixupHooks, and
    # autoPatchelf is one of those hooks, so the restore has to be appended
    # to the hook list from preFixup.
    preFixup = ''
      roxysuNode="$out/lib/${pname}/resources/node/node"
      if [ -e "$roxysuNode" ]; then
        mv "$roxysuNode" "$TMPDIR/roxysu-node-unpatched"
      fi
      roxysuRestoreNode() {
        if [ -e "$TMPDIR/roxysu-node-unpatched" ]; then
          mv "$TMPDIR/roxysu-node-unpatched" "$out/lib/${pname}/resources/node/node"
          chmod +x "$out/lib/${pname}/resources/node/node"
        fi
      }
      postFixupHooks+=(roxysuRestoreNode)
    '';

    installPhase = ''
      runHook preInstall

      appdir="$out/lib/${pname}"
      resources="$appdir/resources"
      mkdir -p "$appdir" "$out/share/icons/hicolor/512x512/apps"

      cp -a . "$appdir/"

      # Unpack realm so autoPatchelf can fix realm.node RPATH (store-stable).
      if [ -f "$resources/realm-reader.tgz" ]; then
        tar -xzf "$resources/realm-reader.tgz" -C "$resources"
        rm -f "$resources/realm-reader.tgz"
        test -f "$resources/realm-reader/index.js"
        test -f "$resources/realm-reader/node_modules/realm/prebuilds/node/realm.node"
      fi

      test -x "$resources/node/node"
      test -f "$resources/node/VERSION"
      test -f "$resources/server/index.node.js"
      test -f "$resources/public/index.html"

      # Natives in the tarball are built for this Node major. A CI bump must
      # fail here instead of loading an ABI-mismatched .node under nodejs_22.
      bundledNodeVersion="$(tr -d '[:space:]' < "$resources/node/VERSION")"
      case "$bundledNodeVersion" in
        22.*) ;;
        *)
          echo "linux-resources Node $bundledNodeVersion is not Node 22; natives will not load in nixpkgs nodejs_22" >&2
          exit 1
          ;;
      esac

      if [ -f "$resources/public/icons/icon-512.png" ]; then
        cp "$resources/public/icons/icon-512.png" \
          "$out/share/icons/hicolor/512x512/apps/${pname}.png"
      fi

      # Optional in-game overlay host (Wayland). Symlink keeps store sharing;
      # its RPATH already points at the GTK/WebKit libs in its own closure.
      ${lib.optionalString (overlayBin != null) ''
        mkdir -p "$resources/overlay"
        ln -sfn "${overlayBin}/bin/roxysu-overlay" \
          "$resources/overlay/roxysu-overlay"
        test -e "$resources/overlay/roxysu-overlay"
      ''}

      # Launch nixpkgs Node 22. resources/node/node is the nodejs.org binary
      # from CI; executing it on NixOS SIGSEGVs (see preFixup).
      makeWrapper "${electron}/bin/electron" "$out/bin/${pname}" \
        --add-flags "$appdir" \
        --set ELECTRON_SKIP_BINARY_DOWNLOAD "1" \
        --set ROXYSU_RESOURCES "$resources" \
        --set ROXYSU_NODE_BIN "${nodejs_22}/bin/node" \
        --set ROXYSU_LIBRARY_PATH "${libraryPath}" \
        --set-default HUB_URL "https://roxysu-api.yonx.app" \
        --prefix LD_LIBRARY_PATH : "${libraryPath}"

      runHook postInstall
    '';

    meta = {
      description = "Roxysu — osu! practice companion (prebuilt Linux resources + nixpkgs Electron)";
      homepage = "https://github.com/Yon-Luc/Roxysu";
      license = lib.licenses.mit;
      platforms = ["x86_64-linux"];
      mainProgram = pname;
    };
  }
