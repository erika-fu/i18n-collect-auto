import i18n from './lang'

// Build replacement requires a project runtimeModule export. Vue 2 templates and
// Options API use $t / this.$t from vue-i18n; this helper satisfies the
// buildReplacement.runtimeModule contract and any injected script helpers.
export function t (key, values) {
  return i18n.t(key, values)
}
