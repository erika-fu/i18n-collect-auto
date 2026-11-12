import { MultilingualPanel } from './multilingual/MultilingualPanel'
import { t } from './multilingual/i18n'

const count = 3

export function App() {
  return (
    <main className="page">
      <h1>{t('react.app.title')}</h1>
      <p>{t('react.app.taskSummary', { count })}</p>
      <MultilingualPanel />
    </main>
  )
}
