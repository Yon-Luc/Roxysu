{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  electron,
  zlib,
  openssl,
  icu,
  # Pinned release asset from CI (`desktop:dist:linux-resources`).
  version,
  url,
  hash,
}: let
  pname = "roxysu";

  nativeLibs = [
    stdenv.cc.cc
    zlib
    openssl
    icu
  ];

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
    inherit pname version;

    src = fetchurl {
      inherit url hash;
    };

    sourceRoot = "roxysu";

    nativeBuildInputs = [
      autoPatchelfHook
      makeWrapper
      copyDesktopItems
    ];

    buildInputs = nativeLibs;
    desktopItems = [desktopItem];

    # Native .node addons + bundled Node break if strip runs on them.
    dontStrip = true;

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
      test -f "$resources/server/index.node.js"
      test -f "$resources/public/index.html"

      if [ -f "$resources/public/icons/icon-512.png" ]; then
        cp "$resources/public/icons/icon-512.png" \
          "$out/share/icons/hicolor/512x512/apps/${pname}.png"
      fi

      # Prefer bundled Node (ABI-matched natives from CI). Do not set
      # ROXYSU_NODE_BIN — paths.js will use resources/node/node.
      makeWrapper "${electron}/bin/electron" "$out/bin/${pname}" \
        --add-flags "$appdir" \
        --set ELECTRON_SKIP_BINARY_DOWNLOAD "1" \
        --set ROXYSU_RESOURCES "$resources" \
        --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath nativeLibs}"

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
