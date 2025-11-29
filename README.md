device-replay-card开票介绍：
device-replay-card卡片式一个回放指定实体的卡片



示例配置（家庭设备回放为例）：
type: custom:device-replay-card
card_width: 420
floorplan_height: 330
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

