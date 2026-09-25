/*
 * Rewarded ad adapter
 * -------------------
 * Replace `null` with your ad network integration before publishing.
 * `showRewarded` must return a Promise that resolves only when the viewer
 * completes the ad, and rejects when it fails or is skipped.
 *
 * Example:
 * window.COMPLEX_ATLAS_AD = {
 *   showRewarded: () => yourAdSdk.showRewarded({ placement: 'complex_function' })
 * };
 *
 * Never resolve the Promise from an ad click. Most networks prohibit
 * incentivized clicks; the reward should be tied to viewing/completion only.
 */
window.COMPLEX_ATLAS_AD = null;
