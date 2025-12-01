DeviceReplayCard 项目简介


DeviceReplayCard 是一个专为 Home Assistant 平台设计的自定义 Lovelace 卡片组件，用于可视化智能家居设备的活动历史和实时状态。该组件通过交互式时间线和楼层平面图，帮助用户回顾设备（如灯具、插座、传感器等）的运行记录，支持回放功能以模拟设备在特定日期的激活过程。
主要功能

事件回放与时间线：加载指定日期的设备历史数据（从 Home Assistant 的历史 API 获取），在时间线上显示设备激活段，支持播放/暂停、速度调节（1x-30x）和手动拖拽。支持过滤最小持续时间的事件，避免显示短暂活动。

平面图可视化：在自定义背景图像上叠加设备图标或圆点，根据事件时间点动态高亮活跃设备。支持设备位置、旋转、缩放和分层配置。

传感器数据集成：显示传感器（如温度、湿度）的历史值，在平面图上实时更新当前时间点的读数，支持自定义单位、颜色和位置。

日期与实时模式：内置日期选择器和日历弹出，支持前后切换日期。当选择当天时，提供实时更新，包括进行中事件的动态条和当前时间指示器。

自定义配置：通过 YAML 支持丰富的选项，如房间颜色、设备标签对齐、背景偏移/缩放、最小事件过滤（单位：秒）、预设速度等。兼容多种实体类型（开关、传感器等），并处理跨午夜事件。

适用场景
适用于智能家居用户，特别是需要分析设备使用模式、能源消耗或日常活动的场景。例如，查看空调/灯光的运行时长、传感器读数变化，或调试自动化规则。该组件强调用户友好性，支持移动端响应，并优化了性能


安装与使用




示例配置（家庭设备回放为例）：
type: custom:device-replay-card
card_width: 420
floorplan_height: 330
min_duration_filter: 60                             //时长过滤
background_image: /local/UI/背景/3D图/关灯背景图1.png
background_left: -155
background_top: -90
background_scale: 138                                                                         //图片占卡片宽度的百分比
background_color: >-
  background: #b92b27; background: -webkit-linear-gradient(to right, rgb(185,
  43, 39), rgb(21, 101, 192));  background: linear-gradient(to right, rgb(185,
  43, 39), rgb(21, 101, 192));
time_labels_color: "#fff"
device_label_color: "#fff"
device_label_align: right
device_track_height: 15
device_track_font-size: 10
device_track_bar_wrapper_background: rgba(0,0,0,0.1)
floorplan_border: 0px solid rgb(0 0 0 / 0%)
energy:
  entities:
    - entity: input_number.dian
      name: 电力
      x: 250
      "y": 380
      color: "#000000"
      sensor_background_color: rgba(0, 123, 255, 0.8)
      unit: W
    - entity: input_number.qi
      name: 燃气
      x: 160
      "y": 380
      color: "#ffffff"
      sensor_background_color: rgba(34, 197, 94, 0.8)
      unit: m³
rooms:
  客厅: "#ea5506"
  主卧: "#47885e"
  次卧: "#D0FAE5"
  儿童房: "#FFEDD4"
  餐厅: "#E0E7FF"
  厨房: transparent
  大卫生间: "#65318e"
  小卫生间: "#CBFBF1"
entities:
  - entity: input_boolean.my
    name: 客厅-大灯
    room: 客厅
    image_url: /local/UI/背景/3D图/客厅灯.png
    x: 0
    "y": 0
    image_scale: 138
    rotation: 0
    layer: 1
    color: "#ea5506"
    on_state: "on"
  - entity: input_boolean.kt
    name: 主卧-大灯
    room: 主卧
    image_url: /local/UI/背景/3D图/主卧灯.png
    x: 0
    "y": 0
    image_scale: 138
    rotation: 0
    layer: 1
    color: "#47885e"
    on_state: "on"
  - entity: input_boolean.fs
    name: 大卫生间-换气
    room: 大卫生间
    image_url: /local/UI/风扇/风扇on.svg
    x: 390
    "y": 110
    rotation: 0
    image_scale: 10
    layer: 1
    color: "#65318e"
    on_state: "on"


