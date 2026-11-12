<template>
  <section>
    <h2>{{ title }}</h2>
    <p data-role="automatic-static">{{ `纯静态插值` }}</p>
    <p data-role="explicit-welcome">{{ $t('demo.welcomeBack', { name }) }}</p>
    <p class="note">
      Forbidden interpolation and concatenation samples live in
      <code>fixtures/ForbiddenLiteralPatterns.vue</code>
      (excluded from scan).
    </p>
    <p data-role="explicit-unread">{{ $t('demo.unread.count', { count }) }}</p>
  </section>
</template>

<script>
export default {
  name: 'LiteralPage',
  data () {
    return {
      title: '模板字符串',
      name: '小明',
      count: 3
    }
  }
}
</script>
