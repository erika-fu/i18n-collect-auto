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
    content: "（SCSS 新）";
    margin-left: 4px;
  }

  // 注释不收集
  --label: "变量不收集";
}
</style>

<style lang="sass">
$badge-color: #2c3e50

.badge--sass
  color: $badge-color

  &::after
    content: "（Sass 新）"
    margin-left: 4px

  // 注释不收集
  --label: "变量不收集"
</style>

<style lang="less">
@badge-color: #2c3e50;

.badge--less {
  color: @badge-color;

  &::after {
    content: "（Less 新）";
    margin-left: 4px;
  }

  // 注释不收集
  --label: "变量不收集";
}
</style>

<style lang="stylus">
badge-color = #2c3e50

.badge--stylus
  color badge-color

  &::after
    content "（Stylus 新）"
    margin-left 4px

  // 注释不收集
  --label "变量不收集"
</style>
