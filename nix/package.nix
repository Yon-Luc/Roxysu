{
  lib,
  stdenv,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  fetchurl,
  bun,
  nodejs_24,
  electron,
  python3,
  gcc,
  gnumake,
  pkg-config,
  zlib,
  openssl,
  icu,
  cacert,
  # Set after first build: nix build .#roxysu 2>&1 | … got: sha256-…
  bunDepsHash ? "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
}: let
  pname = "roxysu";
  version = "0.1.10";
  nodejs = nodejs_24;

  # Keep in sync with realm version in bun.lock / apps/realm-reader.
  realmVersion = "12.15.0";
  realmNodePrebuild = fetchurl {
    url = "https://static.realm.io/realm-js-prebuilds/${realmVersion}/realm-v${realmVersion}-napi-v6-linux-x64.tar.gz";
    hash = "sha256-kSqj0DLSCcknrH+++K1ka7cBTg9kliEDIPIesm6EfzU=";
  };

  nativeLibs = [
    stdenv.cc.cc
    zlib
    openssl
    icu
  ];

  # Lockfile + workspace manifests only (for a fixed-output `bun install`).
  bunInstallSrc = lib.cleanSourceWith {
    name = "roxysu-bun-install-src";
    src = ../.;
    filter = path: type: let
      base = baseNameOf path;
    in
      if type == "directory"
      then
        !(builtins.elem base [
          ".git"
          ".direnv"
          ".tmp-win-art"
          "node_modules"
          "dist"
          "result"
          "release"
          "stage"
          "bin"
          "obj"
        ])
      else base == "package.json" || base == "bun.lock" || base == "bunfig.toml";
  };

  bunDeps = stdenv.mkDerivation {
    name = "${pname}-bun-deps-${version}";
    src = bunInstallSrc;
    nativeBuildInputs = [bun cacert];
    dontConfigure = true;
    dontFixup = true;
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = bunDepsHash;
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
    NODE_EXTRA_CA_CERTS = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      # Fetch only — natives rebuilt in the main derivation; Realm Node binary via fetchurl.
      bun install --frozen-lockfile --ignore-scripts
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -a node_modules "$out/"
      # Capture per-workspace node_modules if bun created any.
      for d in apps/*/node_modules packages/*/node_modules; do
        if [ -d "$d" ]; then
          mkdir -p "$out/$(dirname "$d")"
          cp -a "$d" "$out/$d"
        fi
      done
      runHook postInstall
    '';
  };

  src = lib.cleanSourceWith {
    name = "roxysu-src";
    src = ../.;
    filter = path: type: let
      base = baseNameOf path;
    in
      !(builtins.elem base [
        ".git"
        ".direnv"
        ".tmp-win-art"
        "node_modules"
        "result"
        "bin"
        "obj"
      ])
      && !(type == "directory" && builtins.elem base ["stage" "release" "dist"])
      && !(lib.hasPrefix "result" base);
  };

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
    # Electron / Chromium WM_CLASS — helps panel grouping on GNOME/KDE.
    startupWMClass = "Roxysu";
  };

  # Copy a package (and scoped sibling platform pkgs) into a stage node_modules.
  copyWorkspacePkg = ''
    # Copy every package from a bun isolate node_modules into dest, dereferencing
    # symlinks and recursively pulling each target's isolate (transitive deps).
    copy_isolate_into_dest() {
      local isolate_nm="$1"
      local dest_nm="$2"
      local sibling sname real child cname creal

      [ -d "$isolate_nm" ] || return 0

      for sibling in "$isolate_nm"/*; do
        [ -e "$sibling" ] || [ -L "$sibling" ] || continue
        sname="$(basename "$sibling")"
        [ "$sname" = ".bin" ] && continue

        # Scoped folder (e.g. @realm) — resolve each child package.
        if [ -d "$sibling" ] && [ "''${sname:0:1}" = "@" ] && [ ! -L "$sibling" ]; then
          mkdir -p "$dest_nm/$sname"
          for child in "$sibling"/*; do
            [ -e "$child" ] || [ -L "$child" ] || continue
            cname="$(basename "$child")"
            if [ -e "$dest_nm/$sname/$cname" ]; then
              continue
            fi
            creal="$(readlink -f "$child" || true)"
            if [ -z "$creal" ] || [ ! -e "$creal" ]; then
              echo "warn: skip broken $sname/$cname" >&2
              continue
            fi
            cp -a "$creal" "$dest_nm/$sname/$cname"
            chmod -R u+w "$dest_nm/$sname/$cname"
            echo "  + $sname/$cname"
            # Transitive: also absorb that package's isolate.
            copy_isolate_into_dest "$(dirname "$creal")" "$dest_nm"
          done
          continue
        fi

        if [ -e "$dest_nm/$sname" ]; then
          continue
        fi

        real="$(readlink -f "$sibling" || true)"
        if [ -z "$real" ] || [ ! -e "$real" ]; then
          echo "warn: skip broken $sname" >&2
          continue
        fi
        # Scoped package path like …/node_modules/@foo/bar — rare as direct sibling.
        mkdir -p "$dest_nm/$(dirname "$sname")"
        cp -a "$real" "$dest_nm/$sname"
        chmod -R u+w "$dest_nm/$sname"
        echo "  + $sname"
        copy_isolate_into_dest "$(dirname "$real")" "$dest_nm"
      done
    }

    copy_workspace_pkg() {
      local name="$1"
      local dest_nm="$2"
      local found="" src_dir parent_nm

      found="$(find ./node_modules/.bun -path "*/node_modules/$name/package.json" -print -quit 2>/dev/null || true)"
      if [ -z "$found" ]; then
        found="$(find . -path "*/node_modules/$name/package.json" -print -quit 2>/dev/null || true)"
      fi
      if [ -z "$found" ]; then
        echo "error: could not find workspace package $name" >&2
        return 1
      fi
      src_dir="$(dirname "$found")"
      parent_nm="$(dirname "$src_dir")"
      echo "copy isolate for $name ← $parent_nm"
      copy_isolate_into_dest "$parent_nm" "$dest_nm"
      if [ ! -e "$dest_nm/$name" ] && [ ! -e "$dest_nm/$(dirname "$name")/$(basename "$name")" ]; then
        # name may be scoped; ensure primary package exists
        if [ ! -d "$dest_nm/$name" ]; then
          echo "error: $name missing after isolate copy" >&2
          return 1
        fi
      fi
    }

    copy_napi_scope() {
      local dest_nm="$1"
      mkdir -p "$dest_nm/@napi-rs"
      find ./node_modules -type d -path '*/node_modules/@napi-rs/*' 2>/dev/null | while read -r dir; do
        local name
        name="$(basename "$dir")"
        case "$name" in
          lzma|lzma-*)
            rm -rf "$dest_nm/@napi-rs/$name"
            cp -a "$dir" "$dest_nm/@napi-rs/$name"
            chmod -R u+w "$dest_nm/@napi-rs/$name"
            echo "copied @napi-rs/$name ← $dir"
            ;;
        esac
      done
      if [ ! -d "$dest_nm/@napi-rs/lzma" ]; then
        echo "error: @napi-rs/lzma missing after copy" >&2
        return 1
      fi
    }
  '';
in
  stdenv.mkDerivation {
    inherit pname version src;

    nativeBuildInputs = [
      bun
      nodejs
      makeWrapper
      copyDesktopItems
      python3
      gcc
      gnumake
      pkg-config
      cacert
    ];

    buildInputs = nativeLibs ++ [electron];
    desktopItems = [desktopItem];

    # Native .node addons break if strip runs on them.
    dontStrip = true;

    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    REALM_DISABLE_ANALYTICS = "1";
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
    NODE_EXTRA_CA_CERTS = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      export PATH="${nodejs}/bin:$PATH"

      echo "restoring bun node_modules"
      cp -a "${bunDeps}/node_modules" ./node_modules
      for d in "${bunDeps}"/apps/*/node_modules "${bunDeps}"/packages/*/node_modules; do
        if [ -d "$d" ]; then
          rel="''${d#${bunDeps}/}"
          mkdir -p "$(dirname "$rel")"
          rm -rf "$rel"
          cp -a "$d" "$rel"
        fi
      done

      echo "building UI"
      bun run --cwd apps/server build:ui

      export ROXYSU_NODE_BIN="${nodejs}/bin/node"
      export ROXYSU_NODE_VERSION="$(${nodejs}/bin/node -p 'process.versions.node')"
      export ROXYSU_SKIP_NATIVE_INSTALL=1
      export ELECTRON_SKIP_BINARY_DOWNLOAD=1
      export REALM_DISABLE_ANALYTICS=1
      # Offline node-gyp: use nixpkgs headers instead of fetching nodejs.org.
      export npm_config_nodedir="${nodejs}"
      export npm_config_build_from_source=true
      export npm_config_runtime=node
      export npm_config_target="$ROXYSU_NODE_VERSION"

      echo "staging desktop payload (Node $ROXYSU_NODE_VERSION)"
      bun run --cwd apps/desktop build:stage

      ${copyWorkspacePkg}

      mkdir -p apps/desktop/stage/server/node_modules \
               apps/desktop/stage/realm-reader/node_modules

      copy_workspace_pkg "better-sqlite3" apps/desktop/stage/server/node_modules
      copy_napi_scope apps/desktop/stage/server/node_modules

      copy_workspace_pkg "better-sqlite3" apps/desktop/stage/realm-reader/node_modules
      copy_workspace_pkg "realm" apps/desktop/stage/realm-reader/node_modules

      # Realm may pull optional deps; copy common ones if present.
      if find . -path "*/node_modules/bson/package.json" -print -quit | grep -q .; then
        copy_workspace_pkg "bson" apps/desktop/stage/realm-reader/node_modules || true
      fi

      echo "installing Realm Node N-API prebuild ${realmVersion}"
      tar -xzf "${realmNodePrebuild}" -C apps/desktop/stage/realm-reader/node_modules/realm
      test -f apps/desktop/stage/realm-reader/node_modules/realm/prebuilds/node/realm.node

      # Prefer a live symlink to nixpkgs node (copied store binaries may lack +x).
      mkdir -p apps/desktop/stage/node
      ln -sfn "${nodejs}/bin/node" apps/desktop/stage/node/node
      printf '%s\n' "$ROXYSU_NODE_VERSION" > apps/desktop/stage/node/VERSION

      echo "node headers: ${nodejs}/include/node"
      test -d "${nodejs}/include/node"

      bun run --cwd apps/desktop rebuild:native

      rm -rf apps/desktop/stage/realm-reader/node_modules/realm/prebuilds/android \
             apps/desktop/stage/realm-reader/node_modules/realm/prebuilds/apple

      # Final package uses nixpkgs node via ROXYSU_NODE_BIN.
      rm -rf apps/desktop/stage/node

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      appdir="$out/lib/${pname}"
      resources="$appdir/resources"
      mkdir -p "$appdir" "$resources" "$out/share/icons/hicolor/512x512/apps"

      # Keep in sync with apps/desktop electron-builder "files" (minus builder-only bits).
      cp apps/desktop/main.js \
         apps/desktop/auto-update.js \
         apps/desktop/preload.js \
         apps/desktop/paths.js \
         apps/desktop/splash.html \
         apps/desktop/package.json \
         "$appdir/"

      cp -a apps/desktop/stage/public "$resources/public"
      cp -a apps/desktop/stage/server "$resources/server"
      cp -a apps/desktop/stage/realm-reader "$resources/realm-reader"
      cp apps/desktop/stage/splash.html "$resources/splash.html"

      if [ -f apps/server/public/icons/icon-512.png ]; then
        cp apps/server/public/icons/icon-512.png \
          "$out/share/icons/hicolor/512x512/apps/${pname}.png"
      fi

      makeWrapper "${electron}/bin/electron" "$out/bin/${pname}" \
        --add-flags "$appdir" \
        --set ELECTRON_SKIP_BINARY_DOWNLOAD "1" \
        --set ROXYSU_RESOURCES "$resources" \
        --set ROXYSU_NODE_BIN "${nodejs}/bin/node" \
        --set-default HUB_URL "https://roxysu-api.yonx.app" \
        --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath nativeLibs}" \
        --prefix PATH : "${lib.makeBinPath [nodejs]}"

      runHook postInstall
    '';

    meta = {
      description = "Roxysu — osu! practice companion (from-source NixOS Electron package)";
      homepage = "https://github.com/Yon-Luc/Roxysu";
      license = lib.licenses.mit;
      platforms = ["x86_64-linux"];
      mainProgram = pname;
    };
  }
