const { withPodfile } = require('expo/config-plugins');

const MARKER = '# [companion] pods deployment target floor';

// Xcode 27 only builds iOS targets with a deployment target of 15.0 or newer. Some pods the
// SDK pulls in (SwiftProtobuf, SWCompression, BitByteData) still declare iOS 11, and React
// Native's post-install raises their library targets but not their resource-bundle targets,
// so the build fails with "IPHONEOS_DEPLOYMENT_TARGET is set to 11.0". Raise every Pods
// target, resource bundles included, to the app's own deployment target.
const SNIPPET = `
    ${MARKER}
    companion_min_ios = podfile_properties['ios.deploymentTarget'] || '15.1'
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_configuration|
        if build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < companion_min_ios.to_f
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = companion_min_ios
        end
      end
    end
`;

function addPodsDeploymentTargetFloor(podfile) {
  if (podfile.includes(MARKER)) {
    return podfile;
  }
  const anchor = /post_install do \|installer\|\n/;
  if (!anchor.test(podfile)) {
    throw new Error('withPodsDeploymentTarget: no `post_install do |installer|` block found in the Podfile.');
  }
  return podfile.replace(anchor, (match) => `${match}${SNIPPET}`);
}

module.exports = function withPodsDeploymentTarget(config) {
  return withPodfile(config, (podfileConfig) => {
    podfileConfig.modResults.contents = addPodsDeploymentTargetFloor(podfileConfig.modResults.contents);
    return podfileConfig;
  });
};

module.exports.addPodsDeploymentTargetFloor = addPodsDeploymentTargetFloor;
module.exports.MARKER = MARKER;
