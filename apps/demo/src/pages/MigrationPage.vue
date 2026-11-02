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
import { bannerSource, farewellSource, sharedTitle, waitA, waitB } from '../lifecycle'

export default {
  name: 'MigrationPage',
  data () {
    return {
      previousLocale: 'zh',
      bannerSource,
      farewellSource,
      sharedTitle,
      waitA,
      waitB,
      waitKeyA: '',
      waitKeyB: '',
      deletedCount: 3
    }
  },
  created () {
    this.previousLocale = this.$i18n.locale
    this.$i18n.locale = 'en'
    const zhMessages = this.$i18n.messages.zh || {}
    const waitKeys = Object.keys(zhMessages).filter(key => (
      /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/.test(key) && zhMessages[key] === waitA
    )).sort()
    this.waitKeyA = waitKeys[0] || ''
    this.waitKeyB = waitKeys[1] || ''
  },
  beforeDestroy () {
    this.$i18n.locale = this.previousLocale
  }
}
</script>
