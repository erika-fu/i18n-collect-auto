import { setLocale, t } from './i18n'

setLocale('en')

export function MultilingualPanel() {
  return (
    <section className="multilingual" data-role="react-multilingual">
      <h2 data-role="multilingual-title">{t('react.multilingual.title')}</h2>
      <p data-role="multilingual-body">{t('react.multilingual.body', { name: 'Erika' })}</p>
    </section>
  )
}
