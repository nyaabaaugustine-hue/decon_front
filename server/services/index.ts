import { startExpiryChecker, stopExpiryChecker } from './expiry-checker.js';

export function startServices(): void {
  startExpiryChecker();
}

export function stopServices(): void {
  stopExpiryChecker();
}
