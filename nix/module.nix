{self}: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.roxysu;
  defaultPackage =
    self.packages.${pkgs.stdenv.hostPlatform.system}.roxysu
    or self.packages.x86_64-linux.roxysu;
in {
  options.programs.roxysu = {
    enable = lib.mkEnableOption "Roxysu (osu! practice companion)";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "inputs.roxysu.packages.\${pkgs.system}.roxysu";
      description = "Roxysu package to install (binary + desktop entry + icon).";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [cfg.package];
  };
}
