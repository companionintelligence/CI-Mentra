/**
 * Expo writes the launch-screen background into SplashScreen.storyboard as one light colour, a
 * <namedColor> resource. That resource overrides the SplashScreenBackground colour set in
 * Images.xcassets, which also has the dark variant, so dark mode keeps the light background.
 * Removing the resource lets the storyboard read the colour set. This runs as a finalized mod,
 * after every other mod has written the storyboard.
 */
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

const NAMED_COLOR = /\s*<namedColor name="SplashScreenBackground">[\s\S]*?<\/namedColor>/;

module.exports = function withIosSplashBackgroundFromAssets(config) {
  return withFinalizedMod(config, [
    'ios',
    async (modConfig) => {
      const { platformProjectRoot, projectName } = modConfig.modRequest;
      const storyboard = path.join(platformProjectRoot, projectName, 'SplashScreen.storyboard');
      if (fs.existsSync(storyboard)) {
        fs.writeFileSync(storyboard, fs.readFileSync(storyboard, 'utf8').replace(NAMED_COLOR, ''));
      }
      return modConfig;
    },
  ]);
};
