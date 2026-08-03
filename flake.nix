{
  description = "Roxysu (osu! Practice Companion) — NixOS dev shell + installable package";

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

    # After changing bun.lock, rebuild once, then paste the printed sha256 here:
    #   nix build .#roxysu
    bunDepsHash = "sha256-rnCP8I1ob4UF1l48ApqNEGAocep+nLMwc88MdgLMCl0=";

    roxysu = pkgs.callPackage ./nix/package.nix {
      inherit electron bunDepsHash;
      nodejs_24 = pkgs.nodejs_24;
    };
  in {
    packages.${system} = {
      default = roxysu;
      inherit roxysu;
    };

    apps.${system}.default = {
      type = "app";
      program = "${roxysu}/bin/roxysu";
    };

    # NixOS: programs.roxysu.enable = true;
    #   imports = [ inputs.roxysu.nixosModules.default ];
    nixosModules.default = import ./nix/module.nix {inherit self;};
    nixosModules.roxysu = self.nixosModules.default;

    # nix develop — toolchain for hacking (Bun server + Electron smoke).
    # nix build / nix run / nix profile install — packaged desktop app.
    # From GitHub (once pushed): nix run github:Yon-Luc/Roxysu
    # Install into PATH + app menu: nix profile install github:Yon-Luc/Roxysu
    #   or on NixOS: programs.roxysu.enable (see nixosModules above).
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
        echo "Packaged app: nix build .#roxysu && nix run .#roxysu"
      '';
    };
  };
}
