const translations = {
  'demo.visit.banner': 'Welcome aboard',
  'demo.visit.farewell': 'Welcome back'
}

module.exports = {
  translate(request) {
    const drafts = []
    const failures = []
    for (const item of request.items) {
      for (const locale of item.locales) {
        const text = translations[item.key]
        if (text) drafts.push({ key: item.key, locale, text })
        else failures.push({ key: item.key, locale, message: `no demo translation for ${item.key}` })
      }
    }
    return { drafts, failures }
  }
}
