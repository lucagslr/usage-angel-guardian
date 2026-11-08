/** Vue calculée par le moteur (GuardianState sérialisé). */
export type UsageGuardianView = Record<string, unknown>

declare module 'claude-code' {
  interface PluginState {
    'usage-guardian': { view: Shaped<UsageGuardianView | null>; isHidden: boolean }
  }
}
