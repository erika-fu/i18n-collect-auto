<template>
  <section>
    <h2 data-role="multilingual-title">{{ $t('demo.multilingual.title') }}</h2>
    <p data-role="multilingual-body">{{ $t('demo.multilingual.body', { name }) }}</p>
  </section>
</template>

<script>
export default {
  name: 'MultilingualPage',
  data () {
    return {
      previousLocale: 'zh',
      name: 'Erika'
    }
  },
  created () {
    this.previousLocale = this.$i18n.locale
    this.$i18n.locale = 'en'
  },
  beforeDestroy () {
    this.$i18n.locale = this.previousLocale
  }
}
</script>
