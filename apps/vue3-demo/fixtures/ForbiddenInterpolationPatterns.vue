<template>
  <section>
    <label>
      <input :placeholder="'输入' + fieldName + '名称'" aria-label="资料名称">
    </label>
  </section>
</template>

<script>
export default {
  name: 'ForbiddenInterpolationPatterns',
  data () {
    return {
      fieldName: 'profile'
    }
  }
}
</script>
