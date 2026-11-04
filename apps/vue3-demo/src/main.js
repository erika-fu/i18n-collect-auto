import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import messages from '../lang/catalog/zh.json'
import './base.css'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: { zh: messages }
})

createApp(App)
  .use(i18n)
  .mount('#app')
