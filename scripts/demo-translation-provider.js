module.exports = function createDemoTranslationProvider(byKey, bySource) {
  return {
    translate(request) {
      const drafts = []
      const failures = []

      for (const item of request.items) {
        for (const locale of item.locales) {
          const text = locale === 'en' && (byKey[item.key] || bySource[item.source])
          if (text) {
            drafts.push({ key: item.key, locale, text })
          } else {
            failures.push({
              key: item.key,
              locale,
              message: `no demo translation for ${item.key} (${item.source})`
            })
          }
        }
      }

      return { drafts, failures }
    }
  }
}
