<template>
  <main class="demo-shell">
    <section class="demo-panel">
      <p class="eyebrow">Webpack 5 + vue-loader 17</p>
      <!-- i18n-key: vue3.heading -->
      <h1>原生 Vue 三模板</h1>
      <!-- no-i18n-auto -->
      <p>内部标记不收集</p>
      <p title="保存资料">{{ scriptCopy }}</p>
      <p>{{ scriptTemplateCopy }}</p>
      <label>
        <span>{{ '插值字符串' }}</span>
        <input :placeholder="$t('vue3.fieldPlaceholder', { field: fieldName })" aria-label="资料名称">
      </label>
      <p>{{ $t('vue3.welcomeBack', { name }) }}</p>
      <p v-text="'普通指令不收集'"></p>
      <p>{{ $t('vue3.htmlNotice') }}</p>
      <!-- i18n-key: vue3.build.title -->
      <p data-role="build-title">构建替换演示</p>
      <!-- i18n-key: vue3.build.body -->
      <p data-role="build-body">磁盘源码保留中文，正式 bundle 通过 localization key 渲染。</p>
      <p data-role="build-locale">{{ $t('vue3.build.localeLabel') }}</p>
      <div class="locale-switch" data-role="build-locale-switch">
        <button type="button" :class="{ active: locale === 'zh' }" @click="setLocale('zh')">ZH</button>
        <button type="button" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
      </div>
      <ul class="style-formats" aria-label="Style preprocessors">
        <li class="style-format style-format--scss">SCSS</li>
        <li class="style-format style-format--sass">Sass</li>
        <li class="style-format style-format--less">Less</li>
        <li class="style-format style-format--stylus">Stylus</li>
      </ul>
      <p class="note">
        Chinese CSS and static HTML samples live under
        <code>fixtures/</code>
        because Build replacement does not rewrite those positions.
      </p>
    </section>
  </main>
</template>

<script>
export default {
  name: 'CollectionDemo',
  data () {
    return {
      fieldName: 'profile',
      name: 'Alex',
      scriptCopy: '脚本文案',
      scriptTemplateCopy: `脚本模板文案`
    }
  },
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

<style>
.demo-panel::after {
  content: "style tip";
  display: block;
  margin-top: 24px;
  color: #b42318;
  font-size: 12px;
}

.locale-switch {
  display: flex;
  gap: 8px;
  margin: 12px 0 20px;
}

.locale-switch button {
  border: 1px solid #1f7a5a;
  background: #fff;
  color: #1f7a5a;
  padding: 6px 12px;
  cursor: pointer;
}

.locale-switch button.active {
  background: #1f7a5a;
  color: #fff;
}

.note {
  margin-top: 12px;
  color: #52605a;
  font-size: 12px;
}
</style>

<style lang="scss">
$ignored-scss-label: "SCSS var ignored";

.style-format--scss {
  &::after {
    content: "Vue 3 SCSS";
  }
}
</style>

<style lang="sass">
$ignored-sass-label: "Sass var ignored"

.style-format--sass
  &::after
    content: "Vue 3 Sass"
</style>

<style lang="less">
@ignored-less-label: "Less var ignored";

.style-format--less {
  &::after {
    content: "Vue 3 Less";
  }
}
</style>

<style lang="stylus">
ignored-stylus-label = "Stylus var ignored"

.style-format--stylus
  &::after
    content "Vue 3 Stylus"
</style>
