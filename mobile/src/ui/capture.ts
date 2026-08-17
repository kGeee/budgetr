// Photographing a receipt, small enough to send.
//
// The image travels as an op through the relay, so its size is a real cost:
// every byte is encrypted, stored, polled and decrypted. A receipt is text on
// white paper — it needs resolution, not colour depth or dynamic range — so it
// goes out as a modest-quality JPEG rather than whatever the camera produced.
//
// expo-camera and expo-image-manipulator both run inside Expo Go, which is the
// constraint that shaped this whole feature: no custom native module, and
// therefore no on-device text recognition. The phone shoots; the Mac reads.

import { launchCameraAsync, requestCameraPermissionsAsync } from "expo-image-picker";
import { MAX_RECEIPT_BYTES } from "@budgetr/core";

/**
 * Open the camera and return a base64 JPEG, or null if the user backed out or
 * declined the permission.
 *
 * Returns null rather than throwing on refusal: not taking a photo is an
 * ordinary choice, and the caller's answer to it is "type the lines in".
 */
export async function capturePhoto(): Promise<string | null> {
  const perm = await requestCameraPermissionsAsync();
  if (!perm.granted) return null;

  const result = await launchCameraAsync({
    // A receipt is a document. Letting it be cropped square would cut the
    // totals block off the bottom of a long check.
    allowsEditing: false,
    // Enough detail for the recognizer, small enough for the channel — a
    // receipt at this quality lands well inside the ceiling.
    quality: 0.6,
    base64: true,
    exif: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.base64) return null;

  // Base64 inflates by about a third; the contract's ceiling is on the raw
  // bytes, so compare against the decoded size rather than the string length.
  const approxBytes = Math.floor((asset.base64.length * 3) / 4);
  if (approxBytes > MAX_RECEIPT_BYTES) return null;

  return asset.base64;
}
