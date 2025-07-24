const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './bg-bee-icon',
    name: 'BumbleGum Guitars Configurator',
    files:[
      'renderer/**/*',
      'serial/**/*',
      'main.js',
      'preload.js',
      'device.js',
      'package.json'
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupExe: 'BumbleGum Guitars Configurator Setup.exe',
        setupIcon: './bg-bee-icon.ico',
        iconUrl: 'https://raw.githubusercontent.com/wattsy74/bgg-windows-app/main/bg-bee-icon.ico'
      },
    },
    {
      name: '@rabbitholesyndrome/electron-forge-maker-portable',
      config: {
        icon: './bg-bee-icon.ico',
        portable: {
          artifactName: 'BumbleGum-Guitars-Configurator-v${version}-portable.exe',
          requestExecutionLevel: 'user'
        }
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
