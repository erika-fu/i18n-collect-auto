<template>
  <section>
    <h2>{{ title }}</h2>
    <p>收件箱</p>
    <ul>
      <li class="badge badge--scss">SCSS</li>
      <li class="badge badge--sass">Sass</li>
      <li class="badge badge--less">Less</li>
      <li class="badge badge--stylus">Stylus</li>
    </ul>
    <p class="note">
      Chinese CSS generated-content samples live in
      <code>fixtures/StyleCollection.vue</code>
      because Build replacement does not rewrite CSS.
    </p>
  </section>
</template>

<script>
export default {
  name: 'StylePage',
  data () {
    return {
      title: '样式内容'
    }
  }
}
</script>

<style lang="scss">
$badge-color: #2c3e50;

.badge--scss {
  color: $badge-color;

  &::after {
    content: "(SCSS)";
    margin-left: 4px;
  }

  // comment ignored
  --label: "var ignored";
}
</style>

<style lang="sass">
$badge-color: #2c3e50

.badge--sass
  color: $badge-color

  &::after
    content: "(Sass)"
    margin-left: 4px

  // comment ignored
  --label: "var ignored"
</style>

<style lang="less">
@badge-color: #2c3e50;

.badge--less {
  color: @badge-color;

  &::after {
    content: "(Less)";
    margin-left: 4px;
  }

  // comment ignored
  --label: "var ignored";
}
</style>

<style lang="stylus">
badge-color = #2c3e50

.badge--stylus
  color badge-color

  &::after
    content "(Stylus)"
    margin-left 4px

  // comment ignored
  --label "var ignored"
</style>

<style scoped>
.note {
  margin-top: 16px;
  color: #52605a;
  font-size: 12px;
}
</style>
