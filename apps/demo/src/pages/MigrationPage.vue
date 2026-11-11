<template>
  <section>
    <h2>Stable key lifecycle</h2>
    <p data-role="banner-source">{{ bannerSource }}</p>
    <p data-role="banner">{{ $t('demo.visit.banner') }}</p>
    <p data-role="farewell-source">{{ farewellSource }}</p>
    <p data-role="farewell">{{ $t('demo.visit.farewell') }}</p>
    <p data-role="shared-source">{{ sharedTitle }}</p>
    <p data-role="shared-call">{{ $t('demo.shared.title') }}</p>
    <p data-role="wait-a">{{ $t(waitKeyA) }}</p>
    <p data-role="wait-b">{{ $t(waitKeyB) }}</p>
    <p data-role="wait-source-a">{{ waitA }}</p>
    <p data-role="wait-source-b">{{ waitB }}</p>
    <p data-role="legacy">{{ $t('47781b8a72bcbb7ecb1f955399a7e718') }}</p>
    <p data-role="items-deleted">{{ $t('demo.items.deleted', { count: deletedCount }) }}</p>
    <i18n
      path="demo.terms.notice"
      tag="p"
      data-role="terms-notice"
    >
      <a place="terms" href="/terms">{{ $t('demo.terms.link') }}</a>
      <a place="privacy" href="/privacy">{{ $t('demo.privacy.link') }}</a>
    </i18n>
    <p data-role="terms-notice-call">{{ $t('demo.terms.notice', { terms: $t('demo.terms.link'), privacy: $t('demo.privacy.link') }) }}</p>
  </section>
</template>

<script>
export default {
  name: 'MigrationPage',
  data () {
    return {
      previousLocale: 'zh',
      bannerSource: /* i18n-key: demo.visit.banner */ '欢迎',
      farewellSource: /* i18n-key: demo.visit.farewell */ '欢迎',
      sharedTitle: /* i18n-key: demo.shared.title */ '共享标题',
      waitA: /* i18n-key: demo.wait.a */ '请稍候',
      waitB: /* i18n-key: demo.wait.b */ '请稍候',
      waitKeyA: '',
      waitKeyB: '',
      deletedCount: 3
    }
  },
  created () {
    this.previousLocale = this.$i18n.locale
    this.$i18n.locale = 'en'
    this.waitKeyA = 'demo.wait.a'
    this.waitKeyB = 'demo.wait.b'
  },
  beforeDestroy () {
    this.$i18n.locale = this.previousLocale
  }
}
</script>
