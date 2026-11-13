<template>
  <section>
  <!-- Teaching fixture: collect excludes fixtures/**; scan these to practice review → --write. -->
    <p data-role="forbidden-interpolation">{{ `欢迎${name}回来` }}</p>
    <p data-role="forbidden-concatenation">{{ empty + '拼接后的中文' }}</p>
  </section>
</template>

<script>
export default {
  name: 'ForbiddenLiteralPatterns',
  data () {
    return {
      name: '小明',
      empty: ''
    }
  }
}
</script>
