<template>
  <section>
    <h2>Keyed catalog</h2>
    <p data-role="banner">{{ $t('demo.visit.banner') }}</p>
    <p data-role="farewell">{{ $t('demo.visit.farewell') }}</p>
    <p data-role="legacy">{{ $t('47781b8a72bcbb7ecb1f955399a7e718') }}</p>
  </section>
</template>

<script>
export default {
  name: 'MigrationPage',
  data () {
    return {
      previousLocale: 'zh'
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
