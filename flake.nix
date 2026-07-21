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
  in {
    packages.${system}.ffmpeg = pkgs.ffmpeg;

    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [pkgs.bun pkgs.nodejs_24 pkgs.ffmpeg] ++ nativeDeps;

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

      shellHook = ''
        export FFMPEG_PATH="${pkgs.ffmpeg}/bin/ffmpeg"
        echo "Roxysu dev shell — bun $(bun --version), node $(node --version)"
      '';
    };
  };
}
