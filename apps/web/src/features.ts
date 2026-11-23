/** Owners/review gates prevent inactive work from becoming permanent hidden features. */
export const featureFlags = Object.freeze({
  pairing: { enabled: true, owner: "session", reviewIn: "F04" },
  orientation: { enabled: false, owner: "controller", reviewIn: "F05" },
  webRtc: { enabled: false, owner: "transport", reviewIn: "F07" },
});
