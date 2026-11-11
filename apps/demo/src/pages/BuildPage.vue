<template>
  <section>
    <!-- i18n-key: demo.build.title -->
    <h2 data-role="build-title">构建替换演示</h2>
    <!-- i18n-key: demo.build.body -->
    <p data-role="build-body">磁盘源码保留中文，正式 bundle 通过 localization key 渲染。</p>
    <p data-role="build-locale">{{ $t('demo.build.localeLabel') }}</p>
    <div class="locale-switch" data-role="build-locale-switch">
      <button type="button" :class="{ active: locale === 'zh' }" @click="setLocale('zh')">ZH</button>
      <button type="button" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
    </div>
  </section>
</template>

<script>
export default {
  name: 'BuildPage',
  computed: {
    locale () {
      return this.$i18n.locale
    }
  },
  methods: {
    setLocale (locale) {
      this.$i18n.locale = locale
    }
  }
}
</script>

<style scoped>
.locale-switch {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.locale-switch button {
  border: 1px solid #2c3e50;
  background: #fff;
  color: #2c3e50;
  padding: 6px 12px;
  cursor: pointer;
}
.locale-switch button.active {
  background: #2c3e50;
  color: #fff;
}
</style>
