/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  appleTeamId: "B9UFFWUAD8",
  name: "budgetr",
  deploymentTarget: "17.0",
  entitlements: {
    // Shared container: the app writes the encrypted-at-rest summary payload
    // here after each sync; the widget reads it. Nothing leaves the device.
    "com.apple.security.application-groups": ["group.dev.budgetr.companion"],
  },
};
