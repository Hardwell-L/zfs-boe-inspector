# 湖北联投 4.2.0 接入证据

目标项目：`/Users/mac/Documents/work/project/湖北联投/联投4.2.0/zfs-boe-prj`

## 版本和构建

- Vue：安装版本 `3.5.39`。
- `@zfs/boe`：`4.2.0-6.4`。
- `@zfs/ui-plus`：`4.2.0-6.4`。
- 项目语言：JavaScript；构建工具：Vue CLI/webpack。
- 本地 wrapper：`src/components/billTemplate.vue`、`src/boeType/NEW_TRAVEL_BOE.vue`。

## 最终模板来源

依赖源码 `zfs-boe-core/src/mixins/getBillTemplate.js` 的 `getTemplate()` 会分别获取子模板和父模板，再调用 `combineTemplate()`。`initBillData.js` 随后执行：

```text
getTemplate
→ templateOp(billTemplate)
→ initBillField(billTemplate)
→ this.template = markRaw(billTemplate)
→ dispatch('template-loaded', this.template)
```

因此采集点是 local `billTemplate.vue` 运行时实例上的最终 `this.template`，而不是重新调用模板接口或截取 `getTemplate()` 中间结果。父子模板的来源信息在最终对象中不稳定保留，首版只承诺展示最终有效配置。

## 字段属性来源

`boeDesign.vue` 通过 `currentAreaIndex/currentFieldIndex` 区分区域与字段：区域描述取 `areaConfig[area.areaCode] || areaConfig.line`，字段描述取 `fieldConfig[field.fieldType]`，再按 `base`、`advance`、`data` 分类。Inspector 复用这两个描述源，但仅净化 `code/label/classify/type/tips`，不复制 designer 组件，也不提供编辑能力。

运行时字段 DOM 身份由 `billField.vue` / `billTd.vue` 的 `fullPath` 生成，格式为 `areaCode.rowIndex.fieldCode`；table-search 使用 `labelCode`。这构成首版页面字段选择器的确定性定位依据。

## 差旅状态和副作用

`calendarData`、`standardAmount`、`standardAmountParamsObj`、`standardDates` 位于 `NEW_TRAVEL_BOE`，不在 `billTemplate` 子组件中。`standardAmountParamsObj` 的 value 包含 `{ boeDate, promise, schemeCode }`；Snapshot 只保留日期、方案编码和未知状态，不序列化或等待 Promise。

`checkStandard()` 会调用接口并修改标准缓存、行超标状态等业务数据；local `beforeSubmit()` 也会触发校验、确认框和接口。因此 Inspector 不调用它们，仅检查页面已经产生的状态。
