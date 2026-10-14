module.exports = {
  translate(request) {
    const drafts = []
    const failures = []
    for (const item of request.items) {
      for (const locale of item.locales) {
        if (item.key === 'home.note') {
          failures.push({ key: item.key, locale, message: 'glossary rejected 备注' })
        } else {
          drafts.push({ key: item.key, locale, text: 'Hello' })
        }
      }
    }
    return { drafts, failures }
  }
}
