{
  description = "Roxysu (osu! Practice Companion) dev environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {inherit system;};

    # Libraries the prebuilt/compiled native binaries (better-sqlite3, realm)
    # need to resolve at runtime, since NixOS has no standard FHS layout.
    nativeDeps = with pkgs; [
      stdenv.cc.cc # libstdc++ — realm's native addon links against it
      zlib
      openssl
      icu # realm-js uses ICU for string/collation handling
    ];

    # Prefer a newer Electron major when available. The wrapped
    # `${electron}/bin/electron` must be used on NixOS — the raw
    # `libexec/electron/electron` binary often SIGILL's without the wrapper.
    # Flake nixpkgs currently has through electron_42 (no _43 yet).
    electron =
      if pkgs ? electron_42
      then pkgs.electron_42
      else pkgs.electron;
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs =
        [pkgs.bun pkgs.nodejs_24 pkgs.dotnet-sdk_8 electron]
        ++ nativeDeps;

      # Fallback build toolchain for node-gyp, in case a package's
      # prebuilt binary doesn't match the installed Node/Bun ABI.
      nativeBuildInputs = with pkgs; [
        python3
        gcc
        gnumake
        pkg-config
      ];

      NIX_LD = "${pkgs.stdenv.cc.libc}/lib/ld-linux-x86-64.so.2";
      NIX_LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath nativeDeps;

      # Skip npm's Electron binary download. Prefer the nixpkgs *wrapper*
      # via PATH / ELECTRON_PATH — do not point tools at libexec directly.
      ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
      ELECTRON_PATH = "${electron}/bin/electron";

      shellHook = ''
        echo "Roxysu dev shell — bun $(bun --version), node $(node --version), electron $(electron --version), dotnet $(dotnet --version)"
      '';
    };
  };
}
