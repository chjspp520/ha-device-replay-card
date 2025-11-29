class DeviceReplayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    this.deviceConfigs = {};
    this.deviceEvents = [];
    this.currentTime = 0;
    this.isPlaying = false;
    this.speed = 1;
    this.imageCache = {};
    this.roomColors = {};
    this.currentStates = {};
    
    this.onGoingUpdateTimer = null;
    this.currentTimeIndicatorTimer = null;
    this.pollingInterval = null;
    
    this.subscriptions = [];
    
    this.hasInitialized = false;
    this._hass = null;
    
    // 新增：存储传感器历史数据
    this.sensorHistory = {};
    this.sensorConfigs = [];
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config && !this.hasInitialized) {
      this.hasInitialized = true;
      this.render();
      setTimeout(() => {
        this.fetchDataAndInitialize();
        this.setupStateListeners();
      }, 100);
    }
  }

  static getStubConfig() {
    return {
      entities: [],
      floorplan_height: 400
    };
  }

  connectedCallback() {
    if (this.hasInitialized && this.config) {
      this.setupStateListeners();
    }
  }

  disconnectedCallback() {
    this.clearSubscriptions();
    if (this.onGoingUpdateTimer) clearInterval(this.onGoingUpdateTimer);
    if (this.currentTimeIndicatorTimer) clearInterval(this.currentTimeIndicatorTimer);
    this.isPlaying = false;
  }

  setConfig(config) {
      if (!config.entities || !Array.isArray(config.entities)) {
        throw new Error('请在 YAML 配置中定义 entities 列表');
      }
      
      this.config = JSON.parse(JSON.stringify(config));
      this.config.background_color = this.config.background_color || '#F8F8FF';
      this.config.floorplan_height = this.config.floorplan_height || 400;
      this.config.time_labels_color = this.config.time_labels_color || '#4b5563';
      this.config.device_label_color = this.config.device_label_color || '#000000';
      this.config.device_label_align = this.config.device_label_align || 'left';
      this.config.device_track_bar_wrapper_background = this.config['device_track_bar_wrapper_background'] || 'rgba(0,0,0,0.05)';
      this.config.card_width = typeof this.config.card_width === 'number' ? this.config.card_width : 400;
      this.config.background_left = this.config.background_left || 0; 
      this.config.background_top = this.config.background_top || 0; 
      this.config.background_scale = this.config.background_scale || 1.0; 
      this.config.trackHeight = parseInt(this.config['device_track_height']) || 20; 
      this.config.labelFontSize = parseInt(this.config['device_track_font-size']) || 12;
      this.config.floorplan_border = this.config['floorplan_border'] || '0px solid rgb(0 0 0 / 9%)';

      this.roomColors = this.config.rooms || {
        '客厅': '#FFE2E2', '主卧': '#FEF9C2', '次卧': '#D0FAE5',
        '儿童房': '#FFEDD4', '餐厅': '#E0E7FF', '厨房': '#F3E8FF',
        '大卫生间': '#F4F4F5', '小卫生间': '#CBFBF1',
      };

      // 新增：初始化传感器配置
      this.sensorConfigs = this.config.energy?.entities || [];
      
      this.isEditing = this.config.test_mode || false;
      
      if (this._hass && !this.hasInitialized) {
          this.hasInitialized = true;
          this.render();
          setTimeout(() => {
            this.fetchDataAndInitialize();
            this.setupStateListeners();
          }, 100);
      }
    }

  setupStateListeners() {
    if (!this._hass) return;

    this.clearSubscriptions();
    const targetEntityIds = this.config.entities.map(e => e.entity);
    this.entityConfigMap = {};
    this.config.entities.forEach(entityConfig => {
      this.entityConfigMap[entityConfig.entity] = entityConfig;
    });

    this._hass.connection.subscribeMessage(
      (message) => {
        if (message.event_type === 'state_changed' && message.data) {
          const entityData = message.data;
          const entityId = entityData.entity_id;
          
          if (targetEntityIds.includes(entityId)) {
            const newState = entityData.new_state?.state;
            if (newState !== undefined) {
              this.currentStates[entityId] = newState;
              const entityConfig = this.entityConfigMap[entityId];
              if (entityConfig) {
                this.handleStateChange(entityId, newState, entityConfig);
              }
            }
          }
        }
      },
      {
        type: 'subscribe_events',
        event_type: 'state_changed'
      }
    ).then(unsubscribe => {
      this.subscriptions.push(unsubscribe);
      this.initializeCurrentStates();
    }).catch(error => {
      console.warn('DeviceReplayCard: WebSocket subscription failed, falling back to polling.', error);
      this.setupPollingListeners();
    });
  }

  setupPollingListeners() {
    if (!this._hass) return;
    
    if (this.pollingInterval) clearInterval(this.pollingInterval);

    const previousStates = {};
    this.config.entities.forEach(e => {
        const stateObj = this._hass.states[e.entity];
        if(stateObj) previousStates[e.entity] = stateObj.state;
    });

    this.pollingInterval = setInterval(() => {
      if (!this._hass) return;
      this.config.entities.forEach(entityConfig => {
        const entityId = entityConfig.entity;
        const currentStateObj = this._hass.states[entityId];
        const currentState = currentStateObj ? currentStateObj.state : null;
        
        if (currentState && currentState !== previousStates[entityId]) {
          previousStates[entityId] = currentState;
          this.currentStates[entityId] = currentState;
          this.handleStateChange(entityId, currentState, entityConfig);
        }
      });
    }, 2000);
  }

  clearSubscriptions() {
    this.subscriptions.forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch(e) {}
      }
    });
    this.subscriptions = [];
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  initializeCurrentStates() {
    if (!this._hass) return;
    
    this.config.entities.forEach(entityConfig => {
      const entityId = entityConfig.entity;
      const stateObj = this._hass.states[entityId];
      if (stateObj) {
        this.currentStates[entityId] = stateObj.state;
        const today = this.getTodayDate();
        if (this.datePicker && this.datePicker.value === today) {
          const isOn = this.isEntityOn(stateObj.state, entityConfig);
          if (isOn) {
            this.createOngoingEvent(entityId, entityConfig);
          }
        }
      }
    });
  }

  handleStateChange(entityId, newState, entityConfig) {
    if (!this.datePicker) return;
    
    const today = this.getTodayDate();
    const isToday = this.datePicker.value === today;
    
    if (!isToday) return;

    const isOn = this.isEntityOn(newState, entityConfig);
    const deviceName = entityConfig.name || entityId;
    let shouldUpdate = false;

    if (isOn) {
      const existingEvent = this.deviceEvents.find(event => 
        event.entity_id === entityId && event.isOngoing
      );
      
      if (!existingEvent) {
        const now = new Date();
        const newEvent = {
          device: deviceName,
          start: this.formatTime(now),
          full_start: now.toISOString(),
          entity_id: entityId,
          config: entityConfig,
          isOngoing: true
        };
        this.deviceEvents.push(newEvent);
        shouldUpdate = true;
      }
    } else {
      this.deviceEvents.forEach(event => {
        if (event.entity_id === entityId && event.isOngoing) {
          const now = new Date();
          event.end = this.formatTime(now);
          event.full_end = now.toISOString();
          event.isOngoing = false;
          shouldUpdate = true;
        }
      });
    }

    if (shouldUpdate) {
      this.initializeTracks();
      this.updateFloorplan();
      this.updateIndicatorHeight();
    }
  }

  createOngoingEvent(entityId, entityConfig) {
    const deviceName = entityConfig.name || entityId;
    const existingOngoingEvent = this.deviceEvents.find(event =>
      event.entity_id === entityId && event.isOngoing
    );
    if (!existingOngoingEvent) {
      const now = new Date();
      
      const newEvent = {
        device: deviceName,
        start: this.formatTime(now),
        full_start: now.toISOString(),
        entity_id: entityId,
        config: entityConfig,
        isOngoing: true
      };
      this.deviceEvents.push(newEvent);
      this.initializeTracks();
      this.updateFloorplan();
    }
  }

  async getHistory(entityId, startTime, endTime) {
    return new Promise((resolve, reject) => {
      if (!this._hass) {
        resolve([]); 
        return;
      }

      this._hass.connection.sendMessagePromise({
        type: 'history/history_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        entity_ids: [entityId],
        include_start_time_state: true,
        minimal_response: true,
        no_attributes: true
      }).then(response => {
        resolve(response[entityId] || []);
      }).catch(error => {
        console.error("DeviceReplayCard: History fetch error", error);
        resolve([]);
      });
    });
  }

  // 新增：获取传感器历史数据
  async getSensorHistory(entityId, startTime, endTime) {
    return new Promise((resolve, reject) => {
      if (!this._hass) {
        resolve([]);
        return;
      }

      this._hass.connection.sendMessagePromise({
        type: 'history/history_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        entity_ids: [entityId],
        include_start_time_state: true,
        minimal_response: false,
        no_attributes: false
      }).then(response => {
        resolve(response[entityId] || []);
      }).catch(error => {
        console.error("DeviceReplayCard: Sensor history fetch error", error);
        resolve([]);
      });
    });
  }

  // 新增：处理传感器历史数据
  processSensorHistory(entityId, history, selectedDate) {
    const dataPoints = [];
    
    if (!history || history.length === 0) return dataPoints;

    history.forEach(stateObj => {
      const timestamp = new Date(stateObj.lu * 1000);
      const timeStr = this.formatTime(timestamp);
      const value = stateObj.s;
      const attributes = stateObj.a || {};
      
      dataPoints.push({
        entity_id: entityId,
        timestamp: timestamp,
        time: timeStr,
        value: value,
        attributes: attributes
      });
    });

    return dataPoints;
  }

  // 新增：获取所有传感器的历史数据
  async fetchSensorData(dateStr) {
    const startOfDay = new Date(dateStr + 'T00:00:00');
    const endOfDay = new Date(dateStr + 'T23:59:59');
    
    this.sensorHistory = {};
    
    if (!this.sensorConfigs || this.sensorConfigs.length === 0) return;

    const promises = this.sensorConfigs.map(async (sensorConfig) => {
      const entityId = sensorConfig.entity;
      try {
        const history = await this.getSensorHistory(entityId, startOfDay, endOfDay);
        if (history && history.length > 0) {
          const sensorData = this.processSensorHistory(entityId, history, dateStr);
          this.sensorHistory[entityId] = sensorData;
        }
      } catch (error) {
        console.error(`Error fetching sensor history for ${entityId}:`, error);
      }
    });

    await Promise.all(promises);
  }

  // 新增：获取当前时间点的传感器值
  getSensorValueAtTime(entityId, targetTimeSeconds) {
    const sensorData = this.sensorHistory[entityId];
    if (!sensorData || sensorData.length === 0) return null;

    // 找到最接近目标时间的数据点
    let closestData = null;
    let minTimeDiff = Infinity;

    sensorData.forEach(dataPoint => {
      const dataTimeSeconds = this.timeToSeconds(dataPoint.time);
      const timeDiff = Math.abs(dataTimeSeconds - targetTimeSeconds);
      
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestData = dataPoint;
      }
    });

    return closestData;
  }

  async fetchDeviceEvents(dateStr) {
    const startOfDay = new Date(dateStr + 'T00:00:00');
    const endOfDay = new Date(dateStr + 'T23:59:59');
    
    const events = [];
    if (!this.config.entities) return events;

    const promises = this.config.entities.map(async (entityConfig) => {
      const entityId = entityConfig.entity;
      try {
        const history = await this.getHistory(entityId, startOfDay, endOfDay);
        if (history && history.length > 0) {
          const deviceEvents = this.processEntityHistory(entityId, entityConfig, history, dateStr);
          events.push(...deviceEvents);
        }
      } catch (error) {
        console.error(`Error fetching history for ${entityId}:`, error);
      }
    });

    await Promise.all(promises);
    return events;
  }

  processEntityHistory(entityId, entityConfig, history, selectedDate) {
    const events = [];
    let currentEvent = null;
    const today = this.getTodayDate();
    const isToday = selectedDate === today;
    
    let currentRealtimeState = null;
    if (this._hass && this._hass.states[entityId]) {
        currentRealtimeState = this._hass.states[entityId].state;
    }

    history.sort((a, b) => a.lu - b.lu);

    for (let i = 0; i < history.length; i++) {
      const stateObj = history[i];
      const stateValue = stateObj.s;
      const timestampValue = stateObj.lu;
      
      const isOn = this.isEntityOn(stateValue, entityConfig);
      const timestamp = new Date(timestampValue * 1000);
      
      const timeStr = this.formatTime(timestamp);

      if (isOn) {
        if (!currentEvent) {
          currentEvent = {
            device: entityConfig.name || entityId,
            start: timeStr,
            full_start: timestamp.toISOString(),
            entity_id: entityId,
            config: entityConfig,
            isOngoing: false
          };
        }
      } else {
        if (currentEvent) {
          currentEvent.end = timeStr;
          currentEvent.full_end = timestamp.toISOString();
          events.push(currentEvent);
          currentEvent = null;
        }
      }
    }

    if (currentEvent) {
      if (isToday) {
        const isRealtimeOn = this.isEntityOn(currentRealtimeState, entityConfig);
        if (isRealtimeOn) {
            currentEvent.isOngoing = true;
        } else {
            const now = new Date();
            currentEvent.end = this.formatTime(now);
            currentEvent.full_end = now.toISOString();
        }
      } else {
        currentEvent.end = "23:59";
        const endOfDayDate = new Date(selectedDate + 'T23:59:59');
        currentEvent.full_end = endOfDayDate.toISOString();
      }
      events.push(currentEvent);
    }

    return events;
  }

  isEntityOn(state, entityConfig) {
    if (state === undefined || state === null) return false;
    
    if (entityConfig.on_states && Array.isArray(entityConfig.on_states)) {
      return entityConfig.on_states.includes(state);
    }
    if (entityConfig.on_state) {
      return state === entityConfig.on_state;
    }
    
    if (entityConfig.entity.includes('input_boolean')) return state === 'on';
    
    const onStates = ['on', 'open', 'true', 'home', 'active', 'playing', 'cooling', 'heating'];
    const offStates = ['off', 'closed', 'false', 'away', 'idle', 'paused', 'unavailable', 'unknown'];
    
    const stateLower = String(state).toLowerCase();
    
    if (onStates.includes(stateLower)) return true;
    if (offStates.includes(stateLower)) return false;
    
    if (!isNaN(state) && state !== '') return parseFloat(state) > 0;
    
    return !offStates.includes(stateLower);
  }

  formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  formatTimeFromSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  
  getTodayDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  timeToSeconds(time) {
    if (!time) return 0;
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 3600 + minutes * 60;
  }
  
  formatDuration(totalSeconds) {
    if (totalSeconds < 60) return `${Math.round(totalSeconds)}秒`;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}小时${minutes}分钟`;
    }
    return `${minutes}分钟`;
  }

  calculateEventDuration(event) {
      let startSec = this.timeToSeconds(event.start);
      let endSec;
      
      if (event.isOngoing && this.datePicker.value === this.getTodayDate()) {
          const now = new Date();
          endSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      } else if (event.end) {
          endSec = this.timeToSeconds(event.end);
      } else {
          endSec = 86400; 
      }

      let durationSeconds = 0;
      if (endSec < startSec) {
          durationSeconds = (86400 - startSec) + endSec;
      } else {
          durationSeconds = Math.max(0, endSec - startSec);
      }
      
      if (durationSeconds < 60) {
          return `${Math.round(durationSeconds)}秒`;
      }
      
      return this.formatDuration(durationSeconds);
  }
  
  getDeviceColor(deviceName) {
    const config = this.deviceConfigs[deviceName];
    if (config && config.color) return config.color;
    if (deviceName.includes('灯')) return '#fcc800';
    if (deviceName.includes('插座')) return '#1e2a78';
    if (deviceName.includes('人在')) return '#9079ad';
    if (deviceName.includes('监控')) return '#ff5959';
    if (deviceName.includes('空调')) return '#21e6c1';
    return '#aa4c8f';
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${this.getStyles()}
      </style>
      <div class="device-replay-card">
        ${this.getHTMLTemplate()}
      </div>
    `;
    this.initializeElements();
    this.setupEventListeners();
    this.initializeDeviceConfigs();
  }

  initializeElements() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.canvas = $('deviceCanvas');
    this.ctx = this.canvas.getContext("2d");
    this.timeline = $('timeline');
    this.playPauseBtn = $('playPauseBtn');
    this.speedSelect = $('speed');
    this.currentTimeLabel = $('current-time');
    this.timeIndicator = $('time-indicator');
    this.timelineContainer = $('timeline-container');
    this.timelineWrapper = $('timeline-wrapper-content'); 
    this.deviceTracksContainer = $('device-tracks-container');
    this.datePicker = $('date-picker');
    this.prevDayBtn = $('prevDayBtn');
    this.nextDayBtn = $('nextDayBtn');
    this.todayBtn = $('todayBtn');
    this.currentTimeIndicator = $('current-time-indicator');
    this.eventTooltip = $('event-tooltip');
    this.tooltipDeviceName = $('tooltip-device-name');
    this.tooltipEventsList = $('tooltip-events-list');
    this.calendarContainer = $('calendar-container');
    this.calendarMonthYear = $('calendar-month-year');
    this.calendarDays = $('calendar-days');
    this.calendarPrevMonth = $('calendar-prev-month');
    this.calendarNextMonth = $('calendar-next-month');
  }

  initializeDeviceConfigs() {
    this.deviceConfigs = {};
    if (this.config.entities) {
      this.config.entities.forEach(entityConfig => {
        this.deviceConfigs[entityConfig.name || entityConfig.entity] = entityConfig;
      });
    }
  }

  initializeTracks() {
    this.deviceTracksContainer.innerHTML = '';
    const activeDeviceNames = new Set(this.deviceEvents.map(event => event.device));
    
    if (activeDeviceNames.size === 0) {
      this.deviceTracksContainer.innerHTML = `<div class="text-center text-gray-500 mt-4" style="text-align:center; padding:10px; color:#999; font-size:12px;">没有找到设备事件记录</div>`;
      return;
    }

    const today = this.getTodayDate();
    const isToday = this.datePicker.value === today;
    const now = new Date();
    const currentSecondsOfDay = isToday ? now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() : 86400;

    Array.from(activeDeviceNames).sort((a, b) => a.localeCompare(b, 'zh-CN')).forEach(deviceName => {
      const trackDiv = document.createElement('div');
      trackDiv.className = 'device-track';
      
      const labelSpan = document.createElement('span');
      labelSpan.className = 'device-label';
      labelSpan.textContent = deviceName;
      
      const deviceConfig = this.deviceConfigs[deviceName];
      const roomName = deviceConfig?.room || deviceName.split('-')[0];
      labelSpan.style.backgroundColor = this.roomColors[roomName] || '#f0f0f0';

      const barWrapperDiv = document.createElement('div');
      barWrapperDiv.className = 'track-bar-wrapper';
      barWrapperDiv.dataset.device = deviceName;
      
      const barDiv = document.createElement('div');
      barDiv.className = 'track-bar';
      barDiv.id = `${deviceName}-bar`;
      
      barWrapperDiv.appendChild(barDiv);
      trackDiv.appendChild(labelSpan);
      trackDiv.appendChild(barWrapperDiv);
      this.deviceTracksContainer.appendChild(trackDiv);

      const deviceEventsForTrack = this.deviceEvents.filter(event => event.device === deviceName);
      
      deviceEventsForTrack.forEach(event => {
        const startSec = this.timeToSeconds(event.start);
        let endSec = event.end ? this.timeToSeconds(event.end) : 0;
        
        const eventsToRender = [];
        
        if (event.isOngoing && isToday && startSec <= currentSecondsOfDay) {
          eventsToRender.push({
            startSec: startSec,
            endSec: currentSecondsOfDay,
            start: event.start,
            end: "进行中",
            isOngoing: true,
            full_start: event.full_start
          });
        } 
        else if (event.end && endSec < startSec) {
          eventsToRender.push({
            startSec: startSec,
            endSec: 86400,
            start: event.start,
            end: "23:59",
            isCrossMidnight: true
          });
          eventsToRender.push({
            startSec: 0,
            endSec: endSec,
            start: "00:00",
            end: event.end,
            isCrossMidnight: true
          });
        } 
        else {
            const actualEndSec = event.end ? endSec : (isToday ? currentSecondsOfDay : 86400);
            const displayEnd = event.end ? event.end : (isToday ? this.formatTimeFromSeconds(currentSecondsOfDay) : "23:59");
            
            eventsToRender.push({
              startSec: startSec,
              endSec: actualEndSec,
              start: event.start,
              end: displayEnd,
              isOngoing: event.isOngoing
            });
        }

        eventsToRender.forEach((renderEvent) => {
          const left = (renderEvent.startSec / 86400) * 100;
          const fill = document.createElement("div");
          fill.className = `track-fill`;
          fill.style.backgroundColor = this.getDeviceColor(deviceName);
          fill.style.left = `${left}%`;
          
          fill.dataset.device = deviceName;
          fill.dataset.start = renderEvent.start;
          fill.dataset.end = renderEvent.end;
          
          const durationSec = renderEvent.endSec - renderEvent.startSec;
          
          if (renderEvent.isOngoing && isToday && !renderEvent.isCrossMidnight) {
            fill.classList.add('on-going');
            fill.dataset.startTime = renderEvent.startSec;
          }
          
          if (durationSec < 300 && !fill.classList.contains('on-going')) {
            fill.style.width = "4px";
          } else {
            const width = (durationSec / 86400) * 100;
            fill.style.width = `${width}%`;
          }
          
          barDiv.appendChild(fill);
        });
      });
    });
  }

  updateFloorplan() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    const parent = this.canvas.parentElement;
    const previousImgs = parent.querySelectorAll('.device-img');
    previousImgs.forEach(img => img.remove());

    // 移除之前的传感器显示
    const previousSensors = parent.querySelectorAll('.sensor-value-display');
    previousSensors.forEach(sensor => sensor.remove());

    this.renderBackgroundImage();

    const activeDevices = [];

    this.deviceEvents.forEach(event => {
      const startSec = this.timeToSeconds(event.start);
      let endSec = event.end ? this.timeToSeconds(event.end) : this.currentTime;
      
      const isCrossMidnight = event.end && endSec < startSec;
      let isActive = false; // 在这里定义 isActive 变量

      if (isCrossMidnight) {
        if ((this.currentTime >= startSec && this.currentTime <= 86400) ||
            (this.currentTime >= 0 && this.currentTime <= endSec)) {
          isActive = true;
        }
      } else {
        let actualEnd = endSec;
        if (!event.end) actualEnd = 86400;

        if (this.currentTime >= startSec && this.currentTime <= actualEnd) {
          isActive = true;
        }
      }

      if (isActive) {
        const config = this.deviceConfigs[event.device];
        if (config) {
          activeDevices.push({
            name: event.device,
            config: config,
            layer: config.layer || 1
          });
        }
      }
    });

    activeDevices.sort((a, b) => a.layer - b.layer);

    activeDevices.forEach(device => {
      const config = device.config;
      if (config.image_url) {
        const offsetX = this.config.background_left || 0;
        const offsetY = this.config.background_top || 0;

        const actualX = offsetX + (config.x || 0);
        const actualY = offsetY + (config.y || 0);
        
        // 检查是否已经有缓存的图片元素
        const existingImg = parent.querySelector(`.device-img[data-device="${device.name}"]`);
        
        if (existingImg) {
          // 如果已有缓存的图片，直接重新显示而不重新创建
          existingImg.style.display = 'block';
        } else {
          // 创建新的图片元素
          const img = document.createElement('img');
          img.src = config.image_url;
          img.className = 'device-img';
          img.dataset.device = device.name; // 添加设备标识
          img.style.position = 'absolute';
          img.style.left = `${actualX}px`;
          img.style.top = `${actualY}px`;
          img.style.transform = `rotate(${config.rotation || 0}deg)`;
          img.style.transformOrigin = '0 0';
          img.style.pointerEvents = 'none';
          img.style.zIndex = config.layer || 1;

          // 使用缓存避免重复计算
          const cacheKey = `${config.image_url}_${config.image_scale || 'default'}_${config.image_width || 'default'}_${config.image_height || 'default'}`;
          
          if (this.imageCache[cacheKey]) {
            // 使用缓存的尺寸
            const cached = this.imageCache[cacheKey];
            img.style.width = `${cached.width}px`;
            img.style.height = `${cached.height}px`;
            parent.appendChild(img);
          } else {
            // 首次加载，计算尺寸并缓存
            img.onload = () => {          
              const naturalWidth = img.naturalWidth;
              const naturalHeight = img.naturalHeight;

              const hasWidthHeight = config.image_width !== undefined || config.image_height !== undefined;
              const hasScale = config.image_scale !== undefined;
              
              let finalWidth, finalHeight;
              
              if (hasWidthHeight && hasScale) {
                console.error(`DeviceReplayCard: Error in configuration for device ${device.name}. 只能由一种控制方式image_width和 image_height或image_scale控制，请检查代码是否正确！`);
                return; 
              }
              
              if (hasScale) {
                const scale = parseFloat(config.image_scale);
                if (!isNaN(scale) && scale > 0) {
                  const containerWidth = this.config.card_width;
                  finalWidth = (containerWidth * scale) / 100;

                  const aspectRatio = naturalHeight / naturalWidth;
                  finalHeight = finalWidth * aspectRatio;
                } else {
                  finalWidth = naturalWidth;
                  finalHeight = naturalHeight;
                }
              } 
              else if (hasWidthHeight) {
                if (config.image_width !== undefined && config.image_height !== undefined) {
                  finalWidth = config.image_width;
                  finalHeight = config.image_height;
                } else if (config.image_width !== undefined) {
                  finalWidth = config.image_width;
                  finalHeight = (naturalHeight / naturalWidth) * finalWidth;
                } else if (config.image_height !== undefined) {
                  finalHeight = config.image_height;
                  finalWidth = (naturalWidth / naturalHeight) * finalHeight;
                } else {
                  finalWidth = naturalWidth;
                  finalHeight = naturalHeight;
                }
              } else {
                finalWidth = naturalWidth;
                finalHeight = naturalHeight;
              }
              
              img.style.width = `${finalWidth}px`;
              img.style.height = `${finalHeight}px`;
              
              // 缓存尺寸
              this.imageCache[cacheKey] = {
                width: finalWidth,
                height: finalHeight
              };
            };
            
            img.onerror = (e) => {
              console.error(`Failed to load device image: ${config.image_url}`, e);
              img.remove();
              this.ctx.beginPath();
              this.ctx.arc(actualX, actualY, 10, 0, 2 * Math.PI);
              this.ctx.fillStyle = config.color || 'rgba(255, 200, 0, 0.7)';
              this.ctx.fill();
              this.ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
              this.ctx.lineWidth = 2;
              this.ctx.stroke();
            };
            
            parent.appendChild(img);
          }
        }
      } else {
        // 非图片设备的绘制代码
        const offsetX = this.config.background_left || 0;
        const offsetY = this.config.background_top || 0;
        const actualX = offsetX + (config.x || 0);
        const actualY = offsetY + (config.y || 0);
        
        this.ctx.beginPath();
        this.ctx.arc(actualX, actualY, 10, 0, 2 * Math.PI);
        this.ctx.fillStyle = config.color || 'rgba(255, 200, 0, 0.7)';
        this.ctx.fill();
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = config.color || 'yellow';
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
      }
    });

    // 新增：显示传感器值
    this.displaySensorValues();

    this.updateTimelineHighlights();
    
    this.currentTimeLabel.textContent = this.formatTimeFromSeconds(this.currentTime);
    const timelineWidth = this.timelineWrapper.offsetWidth;
    const indicatorLeft = (this.currentTime / 86400) * timelineWidth;
    this.timeIndicator.style.left = `${indicatorLeft}px`;
  }

  displaySensorValues() {
    if (!this.sensorConfigs || this.sensorConfigs.length === 0) return;

    const parent = this.canvas.parentElement;

    this.sensorConfigs.forEach(sensorConfig => {
      const entityId = sensorConfig.entity;
      const sensorData = this.getSensorValueAtTime(entityId, this.currentTime);
      
      if (!sensorData) return;

      const offsetX = this.config.background_left || 0;
      const offsetY = this.config.background_top || 0;
      
      const actualX = offsetX + (sensorConfig.x || 0);
      const actualY = offsetY + (sensorConfig.y || 0);
      
      const valueDisplay = document.createElement('div');
      valueDisplay.className = 'sensor-value-display';
      valueDisplay.style.position = 'absolute';
      valueDisplay.style.left = `${actualX}px`;
      valueDisplay.style.top = `${actualY}px`;
      valueDisplay.style.padding = '2px 6px';
      valueDisplay.style.borderRadius = '4px';
      valueDisplay.style.fontSize = '11px';
      valueDisplay.style.fontWeight = 'bold';
      valueDisplay.style.zIndex = '100';
      valueDisplay.style.pointerEvents = 'none';
      valueDisplay.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
      
      // 设置背景色和文字颜色
      const bgColor = sensorConfig.sensor_background_color || 'rgba(0, 123, 255, 0.9)';
      const textColor = sensorConfig.color || '#ffffff';
      
      valueDisplay.style.backgroundColor = bgColor;
      valueDisplay.style.color = textColor;
      
      // 格式化显示的值
      let displayValue = sensorData.value;
      const unit = sensorConfig.unit || '';
      const name = sensorConfig.name || '';
      
      // 如果是数字，尝试格式化
      if (!isNaN(displayValue) && displayValue !== '') {
        const numValue = parseFloat(displayValue);
        if (numValue < 10) {
          displayValue = numValue.toFixed(1);
        } else {
          displayValue = Math.round(numValue);
        }
      }
      
      // 添加名称显示
      if (name) {
        valueDisplay.textContent = `${name}：${displayValue}${unit}`;
      } else {
        valueDisplay.textContent = `${displayValue}${unit}`;
      }
      
      parent.appendChild(valueDisplay);
    });
  }

  renderBackgroundImage() {
    if (!this.config.background_image) return;
    
    const backgroundImg = this.shadowRoot.getElementById('background-image');
    if (!backgroundImg) return;
    
    backgroundImg.src = this.config.background_image;
    backgroundImg.style.display = 'block';
    
    const containerWidth = this.config.card_width;
    const containerHeight = this.config.floorplan_height;
    const offsetX = this.config.background_left || 0;
    const offsetY = this.config.background_top || 0;
    
    backgroundImg.style.left = `${offsetX}px`;
    backgroundImg.style.top = `${offsetY}px`;
    backgroundImg.style.transformOrigin = '0 0';
    backgroundImg.style.zIndex = '0';
    
    backgroundImg.onload = () => {
      const naturalWidth = backgroundImg.naturalWidth;
      const naturalHeight = backgroundImg.naturalHeight;
      
      const scale = this.config.background_scale || 100;
      const imgWidth = (containerWidth * scale) / 100;
      const aspectRatio = naturalHeight / naturalWidth;
      const imgHeight = imgWidth * aspectRatio;
      
      backgroundImg.style.width = `${imgWidth}px`;
      backgroundImg.style.height = `${imgHeight}px`;
    };
    
    backgroundImg.onerror = () => {
      backgroundImg.style.display = 'none';
    };
  }


  updateTimelineHighlights() {
    const allTracks = this.shadowRoot.querySelectorAll('.track-fill');
    allTracks.forEach(fill => fill.classList.remove('active'));

    this.deviceEvents.forEach(event => {
      const barElement = this.shadowRoot.getElementById(`${event.device}-bar`);
      if (!barElement) return;

      const fills = barElement.querySelectorAll('.track-fill');
      fills.forEach(fill => {
         const fStart = this.timeToSeconds(fill.dataset.start);
         const fEndStr = fill.dataset.end === '进行中' ? '23:59' : fill.dataset.end;
         const fEnd = this.timeToSeconds(fEndStr);
         
         if (this.currentTime >= fStart && this.currentTime <= fEnd) {
             fill.classList.add('active');
         }
      });
    });
  }

  play() {
    if (!this.isPlaying) return;
    
    this.currentTime += 60 * this.speed;
    
    const today = this.getTodayDate();
    let maxTime = 86400;
    if (this.datePicker.value === today) {
        const now = new Date();
        maxTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    }
    
    if (this.currentTime >= maxTime) {
      this.currentTime = maxTime;
      this.isPlaying = false;
      this.playPauseBtn.textContent = "播放";
    }

    this.updateFloorplan();
    this.timeline.value = this.currentTime;
    
    requestAnimationFrame(() => this.play());
  }

  // 修改：获取数据并初始化，添加传感器数据获取
  async fetchDataAndInitialize(date = null) {
    const selectedDate = date || this.getTodayDate();
    this.datePicker.value = selectedDate;
    
    this.hideTooltip();
    
    if(this.deviceTracksContainer) {
        this.deviceTracksContainer.style.opacity = '0.5';
    }

    try {
      // 获取设备事件数据
      this.deviceEvents = await this.fetchDeviceEvents(selectedDate);
      
      // 新增：获取传感器数据
      await this.fetchSensorData(selectedDate);
      
      const today = this.getTodayDate();
      if (selectedDate === today) {
        const now = new Date();
        this.currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      } else {
        this.currentTime = 60;
      }
      this.timeline.value = this.currentTime;
      
      this.initializeTracks();
      this.updateFloorplan();
      this.positionTimeLabels();
      this.updateIndicatorHeight();
      
      if(this.deviceTracksContainer) this.deviceTracksContainer.style.opacity = '1';

      if (selectedDate === today) {
        this.startLiveTimers();
      } else {
        this.stopLiveTimers();
      }

      this.renderCalendar(new Date(selectedDate));
      
    } catch (error) {
      console.error(error);
      if(this.deviceTracksContainer) {
          this.deviceTracksContainer.innerHTML = `<div style="color:red;text-align:center;">加载失败: ${error.message}</div>`;
      }
    }
  }

  startLiveTimers() {
      this.stopLiveTimers();
      this.onGoingUpdateTimer = setInterval(() => this.updateOnGoingTracks(), 60000); 
      this.currentTimeIndicatorTimer = setInterval(() => this.updateCurrentTimeIndicatorPosition(), 1000);
      this.updateCurrentTimeIndicatorPosition();
  }

  stopLiveTimers() {
      if (this.onGoingUpdateTimer) clearInterval(this.onGoingUpdateTimer);
      if (this.currentTimeIndicatorTimer) clearInterval(this.currentTimeIndicatorTimer);
      if (this.currentTimeIndicator) this.currentTimeIndicator.style.display = 'none';
  }

  changeDateByDays(days) {
    const currentDate = new Date(this.datePicker.value);
    currentDate.setDate(currentDate.getDate() + days);
    
    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDate.getDate()).padStart(2, '0');
    const newDate = `${yyyy}-${mm}-${dd}`;
    
    this.datePicker.value = newDate;
    this.fetchDataAndInitialize(newDate);
  }
  
  handleTrackClick(e) {
      const targetTrackWrapper = e.target.closest('.track-bar-wrapper');
      if (!targetTrackWrapper) {
          this.hideTooltip();
          return;
      }

      this.isPlaying = false;
      this.playPauseBtn.textContent = "播放";

      const trackBounds = targetTrackWrapper.getBoundingClientRect();
      const clickX = e.clientX;
      
      const clickOffset = clickX - trackBounds.left;
      const trackWidth = trackBounds.width;
      const clickRatio = Math.max(0, Math.min(1, clickOffset / trackWidth));
      const newTimeSeconds = Math.round(clickRatio * 86400 / 60) * 60; 

      const today = this.getTodayDate();
      let maxTime = 86400;
      if (this.datePicker.value === today) {
          const now = new Date();
          maxTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      }
      this.currentTime = Math.min(newTimeSeconds, maxTime);

      this.timeline.value = this.currentTime;
      this.updateFloorplan(); 

      const deviceName = targetTrackWrapper.dataset.device;
      const events = this.deviceEvents.filter(ev => ev.device === deviceName);
      
      this.showDetailedTooltip(e, deviceName, events, trackBounds);
      e.stopPropagation();
  }

  showDetailedTooltip(e, deviceName, events, trackBounds) {
      if(!this.eventTooltip) return;
      
      e.preventDefault();

      let totalDurationSeconds = 0;
      events.forEach(event => {
          let startSec = this.timeToSeconds(event.start);
          let endSec;
          
          if (event.isOngoing && this.datePicker.value === this.getTodayDate()) {
              const now = new Date();
              endSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
          } else if (event.end) {
              endSec = this.timeToSeconds(event.end);
          } else {
              endSec = 86400;
          }

          if (endSec < startSec) {
              totalDurationSeconds += (86400 - startSec) + endSec;
          } else {
              totalDurationSeconds += Math.max(0, endSec - startSec);
          }
      });
      const totalDurationFormatted = this.formatDuration(totalDurationSeconds);
      
      this.eventTooltip.style.display = 'block';
      this.eventTooltip.style.left = '-1000px'; 
      this.eventTooltip.style.top = '-1000px';
      
      this.tooltipDeviceName.textContent = `${deviceName} (${totalDurationFormatted})`; 
      this.tooltipEventsList.innerHTML = '';
      
      const today = this.getTodayDate();
      const isToday = this.datePicker.value === today;
      const currentTimeSec = this.currentTime;
      let highlightedElement = null;
      
      if (events.length === 0) {
          const li = document.createElement('li');
          li.textContent = '本日无运行记录';
          this.tooltipEventsList.appendChild(li);
      } else {
          events.forEach(ev => {
              const li = document.createElement('li');
              const duration = this.calculateEventDuration(ev);
              
              let startSec = this.timeToSeconds(ev.start);
              let endSec;
              
              if (ev.isOngoing && isToday) {
                 const now = new Date();
                 endSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
              } else if (ev.end) {
                  endSec = this.timeToSeconds(ev.end);
              } else {
                  endSec = 86400;
              }
              
              let endStr;
              if (ev.isOngoing) {
                 endStr = this.formatTime(new Date()) + ' (进行中)'; 
              } else {
                 endStr = ev.end ? ev.end : '23:59';
              }
              
              li.innerHTML = `[${ev.start} - ${endStr}] <span>(${duration})</span>`;
              
              const TOLERANCE = 60 * 10;
              let isCurrentTimeInEvent = false;
    
              if (endSec < startSec) {
                  if (currentTimeSec >= startSec - TOLERANCE || currentTimeSec <= endSec + TOLERANCE) {
                      isCurrentTimeInEvent = true;
                  }
              } 
              else if (currentTimeSec >= startSec - TOLERANCE && currentTimeSec <= endSec + TOLERANCE) {
                  isCurrentTimeInEvent = true;
              }
    
              if (isCurrentTimeInEvent) {
                  li.classList.add('highlighted-event');
                  highlightedElement = li;
              }
              
              this.tooltipEventsList.appendChild(li);
          });
      }

      const TOOLTIP_MIN_WIDTH = 160; 
      const TOOLTIP_MAX_WIDTH = 200;
      const ARROW_SIZE = 7;      
      const HORIZONTAL_CLEARANCE = 25;       
      const MARGIN = 10;     
      const TOOLTIP_WIDTH = Math.min(TOOLTIP_MAX_WIDTH, Math.max(TOOLTIP_MIN_WIDTH, this.eventTooltip.offsetWidth)); 
      const TOOLTIP_MAX_HEIGHT = 150;       
      const TOOLTIP_HEIGHT = Math.min(this.eventTooltip.offsetHeight, TOOLTIP_MAX_HEIGHT); 

      if (highlightedElement) {
          setTimeout(() => {
              highlightedElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
              });
          }, 0); 
      }
      
      const cardRect = this.shadowRoot.querySelector('.device-replay-card').getBoundingClientRect();
      const trackRelativeLeft = trackBounds.left - cardRect.left;
      const trackRelativeWidth = trackBounds.width;
      const clickRelativeY = e.clientY - cardRect.top;
      const clickRelativeX = e.clientX - cardRect.left;
      const trackCenterLine = trackRelativeLeft + trackRelativeWidth / 2;

      let targetLeft, targetTop;
      let arrowSide; 
      if (clickRelativeX < trackCenterLine) {
          arrowSide = 'left';
          targetLeft = clickRelativeX + HORIZONTAL_CLEARANCE; 
      } else {
          arrowSide = 'right';
          const adjustment = 5; 
          targetLeft = clickRelativeX - TOOLTIP_WIDTH - HORIZONTAL_CLEARANCE - adjustment; 
      }
      targetTop = clickRelativeY - (TOOLTIP_HEIGHT / 2);
      const cardHeight = cardRect.height;
      const cardWidth = cardRect.width;
      targetTop = Math.max(MARGIN, targetTop);
      targetTop = Math.min(cardHeight - TOOLTIP_HEIGHT - MARGIN, targetTop);
      targetLeft = Math.max(MARGIN, targetLeft);
      targetLeft = Math.min(cardWidth - TOOLTIP_WIDTH - MARGIN, targetLeft);
      let arrowY = clickRelativeY - targetTop;
      arrowY = Math.max(ARROW_SIZE, Math.min(TOOLTIP_HEIGHT - ARROW_SIZE, arrowY)); 
      this.eventTooltip.style.left = `${targetLeft}px`;
      this.eventTooltip.style.top = `${targetTop}px`;
      this.eventTooltip.style.width = `${TOOLTIP_WIDTH}px`; 
      this.eventTooltip.style.maxHeight = `${TOOLTIP_MAX_HEIGHT}px`; 
      this.eventTooltip.style.setProperty('--arrow-y', `${arrowY}px`);
      this.eventTooltip.dataset.arrow = arrowSide;
      this.eventTooltip.classList.add('active');
  }
  
    hideTooltip() {
      if(this.eventTooltip) {
          this.eventTooltip.style.display = 'none';
          this.eventTooltip.classList.remove('active');
      }
  }

  setupEventListeners() {
  this.timeline.addEventListener("input", (e) => {
    this.isPlaying = false;
    this.playPauseBtn.textContent = "播放";
    let val = parseInt(e.target.value, 10);
    
    const today = this.getTodayDate();
    if (this.datePicker.value === today) {
        const now = new Date();
        const max = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        if(val > max) val = max;
    }
    this.currentTime = val;
    this.updateFloorplan();
    this.hideTooltip(); 
  });

    this.playPauseBtn.addEventListener("click", () => {
      this.isPlaying = !this.isPlaying;
      this.playPauseBtn.textContent = this.isPlaying ? "暂停" : "播放";
      if (this.isPlaying) this.play();
      this.hideTooltip();
    });

    this.speedSelect.addEventListener("change", (e) => {
      this.speed = parseFloat(e.target.value);
      this.hideTooltip();
    });

    this.prevDayBtn.addEventListener('click', () => this.changeDateByDays(-1));
    this.nextDayBtn.addEventListener('click', () => this.changeDateByDays(1));
    this.todayBtn.addEventListener('click', () => {
        this.datePicker.value = this.getTodayDate();
        this.fetchDataAndInitialize(this.datePicker.value);
    });

    this.deviceTracksContainer.addEventListener('click', (e) => this.handleTrackClick(e));

    document.addEventListener('click', (e) => {
        const isClickInsideTooltip = e.composedPath().some(el => el === this.eventTooltip);
        if (!isClickInsideTooltip) {
            this.hideTooltip();
        }
    });

    this.calendarPrevMonth.addEventListener('click', () => this.changeCalendarMonth(-1));
    this.calendarNextMonth.addEventListener('click', () => this.changeCalendarMonth(1));
    
    this.datePicker.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleCalendar();
    });

    document.addEventListener('click', (e) => {
      if (!e.composedPath().includes(this.calendarContainer) && 
          !e.composedPath().includes(this.datePicker)) {
        this.calendarContainer.style.display = 'none';
      }
    });
  }

  changeCalendarMonth(direction) {
    const currentDate = this.calendarCurrentDate || new Date();
    currentDate.setMonth(currentDate.getMonth() + direction);
    this.renderCalendar(currentDate);
  }

  renderCalendar(date = new Date()) {
    this.calendarCurrentDate = date;
    const year = date.getFullYear();
    const month = date.getMonth();

    this.calendarMonthYear.textContent = `${year}年${month + 1}月`;
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const daysInMonth = lastDay.getDate();

    const firstDayOfWeek = firstDay.getDay();

    this.calendarDays.innerHTML = '';

    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(day => {
      const weekdayElement = document.createElement('div');
      weekdayElement.className = 'calendar-weekday';
      weekdayElement.textContent = day;
      this.calendarDays.appendChild(weekdayElement);
    });
    
    for (let i = 0; i < firstDayOfWeek; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day empty';
      this.calendarDays.appendChild(emptyCell);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayElement = document.createElement('div');
      dayElement.className = 'calendar-day';
      dayElement.textContent = day;
      
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dayElement.dataset.date = dateStr;
      
      this.checkDateHasData(dateStr).then(hasData => {
        if (hasData) {
          dayElement.classList.add('has-data');
        }
      });
      
      const today = this.getTodayDate();
      if (dateStr === today) {
        dayElement.classList.add('today');
      }

      if (dateStr === this.datePicker.value) {
        dayElement.classList.add('selected');
      }
      
      dayElement.addEventListener('click', () => {
        this.datePicker.value = dateStr;
        this.fetchDataAndInitialize(dateStr);
        this.calendarContainer.style.display = 'none';
      });
      
      this.calendarDays.appendChild(dayElement);
    }
  }

  async checkDateHasData(dateStr) {
    try {
      const events = await this.fetchDeviceEvents(dateStr);
      return events.length > 0;
    } catch (error) {
      console.error(`Error checking data for ${dateStr}:`, error);
      return false;
    }
  }

  updateCalendar() {
    if (this.calendarCurrentDate) {
      this.renderCalendar(this.calendarCurrentDate);
    }
  }
  
  toggleCalendar() {
    const calendar = this.calendarContainer;
    const datePicker = this.datePicker;
    
    if (calendar.style.display === 'block') {
      calendar.style.display = 'none';
      return;
    }
    
    if (!this.calendarCurrentDate) {
      this.calendarCurrentDate = new Date(this.datePicker.value);
    }
    
    const rect = datePicker.getBoundingClientRect();
    const cardRect = this.shadowRoot.querySelector('.device-replay-card').getBoundingClientRect();
    
    calendar.style.display = 'block';
    calendar.style.position = 'absolute';
    calendar.style.top = `${rect.top - cardRect.top - calendar.offsetHeight - 5}px`;
    calendar.style.left = `${rect.left - cardRect.left}px`;
    calendar.style.zIndex = '1000';
    
    this.renderCalendar(this.calendarCurrentDate);
  }
  
  updateOnGoingTracks() {
      const today = this.getTodayDate();
      if (this.datePicker.value !== today) return;

      const now = new Date();
      const currentSecondsOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      
      const onGoingFills = this.shadowRoot.querySelectorAll('.track-fill.on-going');
      onGoingFills.forEach(fill => {
        const startTime = parseInt(fill.dataset.startTime, 10);
        const width = Math.max(0, ((currentSecondsOfDay - startTime) / 86400) * 100);
        fill.style.width = `${width}%`;
      });
  }

  updateCurrentTimeIndicatorPosition() {
    const now = new Date();
    const currentSecondsOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const timelineWidth = this.timelineWrapper.offsetWidth;
    const left = (currentSecondsOfDay / 86400) * timelineWidth;
    this.currentTimeIndicator.style.left = `${left}px`;
    this.currentTimeIndicator.style.display = 'block';
  }

  positionTimeLabels() {
      const contentHeight = this.deviceTracksContainer.offsetHeight;
      if(this.timeIndicator) this.timeIndicator.style.height = (contentHeight + 40) + 'px';
      if(this.currentTimeIndicator) this.currentTimeIndicator.style.height = (contentHeight + 50) + 'px';
  }
  
  updateIndicatorHeight() {
    const tracksContainer = this.deviceTracksContainer;
    const timelineWrapper = this.timelineWrapper;
    const timeLabelsElement = this.shadowRoot.querySelector('.time-labels');

    if (!tracksContainer || !timelineWrapper || !timeLabelsElement) return;

    const tracksRect = tracksContainer.getBoundingClientRect();
    const wrapperRect = timelineWrapper.getBoundingClientRect();
    const labelsRect = timeLabelsElement.getBoundingClientRect();

    const topOffset = tracksRect.top - wrapperRect.top; 

    const totalHeightRaw = labelsRect.bottom - tracksRect.top; 
    
    const heightAdjustment = 18;
    const totalHeightAdjusted = totalHeightRaw - heightAdjustment;
    
    if(this.timeIndicator) {
        this.timeIndicator.style.top = `${topOffset}px`;
        this.timeIndicator.style.height = `${totalHeightAdjusted}px`;
    }
    
    if(this.currentTimeIndicator) {
        this.currentTimeIndicator.style.top = `${topOffset}px`;
        this.currentTimeIndicator.style.height = `${totalHeightAdjusted + 5}px`; 
    }
  }
  
  getStyles() {
    return `
      :host { 
        display: block; 
        position: relative; 
      }
      .device-replay-card {
        background-color: ${this.config.background_color};
        padding: 8px;
        border-radius: 12px;
        color: #333;
        font-family: system-ui, sans-serif;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        position: relative;
        width: 100%;
        max-width: ${this.config.card_width}px;
        margin: 0 auto;
        box-sizing: border-box; 
      }
      
      #floorplan {
        position: relative;
        width: 100%;
        height: ${this.config.floorplan_height}px;
        margin-bottom: 20px;
        overflow: hidden;
        border: ${this.config.floorplan_border};
        border-radius: 8px;
        background-color: ${this.config.background_color};
      }
      
      #background-image {
        position: absolute;
        z-index: 0;
        pointer-events: none;
      }
      
      #deviceCanvas {
        position: relative;
        z-index: 1;
      }
      
      /* 新增：传感器值显示样式 */
      .sensor-value-display {
        transition: all 0.3s ease;
        min-width: 40px;
        text-align: center;
        white-space: nowrap;
      }
      
      .timeline-aligner { 
          display: flex; 
          align-items: center;
          width: 100%;
          min-height: 18px;
      }
      .timeline-aligner-spacer { 
          width: 110px;
          flex-shrink: 0; 
      }
      #timeline::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px; 
        height: 12px;
        border-radius: 50%;
        background: #333; 
        cursor: pointer;
        margin-top: -4px; 
        border: 1px solid #fff; 
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
      }

      #timeline::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #333;
        cursor: pointer;
        border: 1px solid #fff;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
      }
      
      #timeline::-ms-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #333;
        cursor: pointer;
        border: 1px solid #fff;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
      }      
      
      
      #timeline-wrapper-content { 
          flex-grow: 1; 
          position: relative; 
          margin-left: 0;
      }
      #timeline-container { margin-top: 10px; }
      .device-track { display: flex; align-items: center; margin-bottom: 8px; height: ${this.config.trackHeight}px ;width: 100%;}
      .device-label { 
        width: 100px; font-size: ${this.config.labelFontSize}px; white-space: nowrap; overflow: hidden; 
        text-overflow: ellipsis; margin-right: 10px; padding: 2px 6px; 
        border-radius: 4px; color: ${this.config.device_label_color}; flex-shrink: 0; text-align: ${this.config.device_label_align};box-sizing: border-box;
      }
      .track-bar-wrapper { 
        flex-grow: 1; 
        position: relative; 
        height: 100%; 
        background: ${this.config.device_track_bar_wrapper_background};
        border-radius: 4px; 
        cursor: pointer; 
        margin-right: 0;
      }
      .track-bar { width: 100%; height: 100%; position: relative; }
      .track-fill { 
        position: absolute; height: 100%; top: 0; opacity: 0.7; border-radius: 2px;
        transition: opacity 0.2s;
      }
      .track-fill.active { opacity: 1; box-shadow: 0 0 4px rgba(0,0,0,0.3); z-index: 2; }
      
      @keyframes stripe-move {
          from { background-position: 0 0; }
          to { background-position: 1rem 0; }
      }
      @keyframes rainbow-glow {
          0% { box-shadow: 0 0 6px 2px rgba(255, 0, 0, 0.8), 0 0 12px 4px rgba(255, 165, 0, 0.6); }
          14% { box-shadow: 0 0 6px 2px rgba(255, 165, 0, 0.8), 0 0 12px 4px rgba(255, 255, 0, 0.6); }
          28% { box-shadow: 0 0 6px 2px rgba(255, 255, 0, 0.8), 0 0 12px 4px rgba(0, 128, 0, 0.6); }
          42% { box-shadow: 0 0 6px 2px rgba(0, 128, 0, 0.8), 0 0 12px 4px rgba(0, 255, 255, 0.6); }
          57% { box-shadow: 0 0 6px 2px rgba(0, 255, 255, 0.8), 0 0 12px 4px rgba(0, 0, 255, 0.6); }
          71% { box-shadow: 0 0 6px 2px rgba(0, 0, 255, 0.8), 0 0 12px 4px rgba(128, 0, 128, 0.6); }
          85% { box-shadow: 0 0 6px 2px rgba(128, 0, 128, 0.8), 0 0 12px 4px rgba(255, 0, 0, 0.6); }
          100% { box-shadow: 0 0 6px 2px rgba(255, 0, 0, 0.8), 0 0 12px 4px rgba(255, 165, 0, 0.6); }
      }      
      
      .track-fill.on-going {
        background-image: linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);
        background-size: 1rem 1rem;
        animation: stripe-move 1s linear infinite, rainbow-glow 8s linear infinite;
      }

      input[type=range] { width: 103%; display: block; margin: -5px; }
      
      .time-labels { 
          position: relative; 
          width: 100%; 
          height: 10px; 
          margin-top: -5px; 
          font-size: 10px; 
          color: ${this.config.time_labels_color}; 
      }
      
    .time-labels span {
        position: absolute;
        top: 0;
        white-space: nowrap;
        box-sizing: border-box; 
        transform: translateX(-50%);
    }

    .time-labels span:nth-child(1) { 
        left: 0%; 
        transform: translateX(0%); 
    } 
    .time-labels span:nth-child(2) { left: calc(100% / 6 * 1); }
    .time-labels span:nth-child(3) { left: calc(100% / 6 * 2); }
    .time-labels span:nth-child(4) { left: calc(100% / 6 * 3); }
    .time-labels span:nth-child(5) { left: calc(100% / 6 * 4); }
    .time-labels span:nth-child(6) { left: calc(100% / 6 * 5); }
    .time-labels span:nth-child(7) { 
        left: 100%; 
        transform: translateX(-100%);
    }

      #time-indicator {
        position: absolute; top: -105px; width: 2px; background: red; pointer-events: none; z-index: 10;
      }
      #current-time {
        position: absolute; top: -20px; left: -20px; background: red; color: white; 
        font-size: 10px; padding: 1px 4px; border-radius: 3px; width: 40px; text-align: center;
      }
      
      #current-time-indicator {
        position: absolute; top: -105px; width: 1px; border-left: 1px dashed blue; pointer-events: none; z-index: 9;
        display: none;
      }

      .controls { display: flex; gap: 4px; justify-content: center; align-items: center; margin-top: 15px; }
      
      .controls button, .controls select, .controls input[type=date] {
        padding: 4px 8px; 
        background: #007bff; 
        color: white; 
        border: 1px solid #007bff; 
        border-radius: 4px; 
        cursor: pointer; 
        font-size: 10px;
        box-shadow: none;
      }
      .controls button:hover, .controls select:hover { background: #0056b3; }
      
      .controls input[type=date] { 
        color: #333; 
        background: white; 
        border-color: #ccc; 
        min-width: 60px;
        cursor: pointer;
      } 
      
    /* 弹出日历样式 */
    .calendar-popup {
      display: none;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      width: 240px;
    }
    
    .calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding: 0 4px;
    }
    
    .calendar-month-year {
      font-weight: bold;
      font-size: 13px;
      color: #333;
    }
    
    .calendar-nav button {
      padding: 2px 6px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
    }
    
    .calendar-nav button:hover {
      background: #0056b3;
    }
    
    .calendar-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 1px;
      font-size: 11px;
    }
    
    .calendar-weekday {
      text-align: center;
      font-weight: bold;
      padding: 4px 0;
      color: #666;
      font-size: 10px;
    }
    
    .calendar-day {
      text-align: center;
      padding: 6px 0;
      cursor: pointer;
      border-radius: 3px;
      transition: all 0.2s;
      min-height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .calendar-day:hover {
      background: #f0f0f0;
    }
    
    .calendar-day.today {
      background: #fff9c4;
      color: #ea5506;
    }
    
    .calendar-day.selected {
      border: 1px solid #007bff;
      background: #e3f2fd;
    }
    
    .calendar-day.has-data {
      background: #e3f2fd;
      position: relative;
    }
    
    .calendar-day.has-data::after {
      content: '';
      position: absolute;
      bottom: 2px;
      left: 50%;
      transform: translateX(-50%);
      width: 3px;
      height: 3px;
      background: #007bff;
      border-radius: 50%;
    }
    
    .calendar-day.empty {
      background: transparent;
      cursor: default;
    }

      #event-tooltip {
          position: absolute; 
          background-color: #007bff;
          color: white;
          border-radius: 6px;
          padding: 10px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.5);
          z-index: 2000; 
          display: none;
          min-width: 160px; 
          max-width: 200px;
          font-size: 11px;
          line-height: 1.4;
          --arrow-y: 50%;
          max-height: 150px;
      }
      #event-tooltip strong { display: block; margin-bottom: 5px; color: #ffffff; }

      #event-tooltip ul { 
          list-style: none; 
          padding: 0; 
          margin: 0; 
          max-height: 120px; 
          overflow-y: auto; 
      }
      
      #event-tooltip ul li { 
          margin-bottom: 3px; 
          border-bottom: 1px dashed rgba(255, 255, 255, 0.3);
          padding: 3px 0; 
          font-size: 11px;
          transition: background-color 0.2s;
      }
      
      #event-tooltip ul li.highlighted-event {
          background-color: #0056b3; 
          padding: 3px 5px; 
          border-radius: 4px;
          border-bottom: none; 
      }
      #event-tooltip ul li.highlighted-event span,
      #event-tooltip ul li.highlighted-event {
          color: white; 
      }

      #event-tooltip ul li span {
          color: #cbdbf7; 
      }

      #event-tooltip[data-arrow]::after {
          content: '';
          position: absolute;
          top: var(--arrow-y);
          transform: translateY(-50%);
          width: 0;
          height: 0;
          bottom: auto; 
          border-color: transparent;
      }
      
      #event-tooltip[data-arrow="left"]::after {
          left: -7px;
          border-top: 7px solid transparent; 
          border-bottom: 7px solid transparent; 
          border-right: 7px solid #007bff;
      }

      #event-tooltip[data-arrow="right"]::after {
          right: -7px;
          border-top: 7px solid transparent;
          border-bottom: 7px solid transparent;
          border-left: 7px solid #007bff; 
      }

      .device-img { transition: none !important; } 
    `;
  }

  getHTMLTemplate() {
    const timeLabelsHtml = `
      <span>00:00</span>
      <span>04:00</span>
      <span>08:00</span>
      <span>12:00</span>
      <span>16:00</span>
      <span>20:00</span>
      <span>24:00</span>
    `;

    return `
      <div id="floorplan">
        <img id="background-image" style="position: absolute; top: 0; left: 0; display: none;">
        <canvas id="deviceCanvas" width="${this.config.card_width}" height="${this.config.floorplan_height}"></canvas>
      </div>
      
      <div class="calendar-popup" id="calendar-container">
        <div class="calendar-header">
          <button id="calendar-prev-month">◀</button>
          <div id="calendar-month-year"></div>
          <button id="calendar-next-month">▶</button>
        </div>
        <div class="calendar-days" id="calendar-days"></div>
      </div>
      
      ${this.getTimelineHTML(timeLabelsHtml)}
    `;
  }

  getTimelineHTML(timeLabelsHtml) {
    return `
      <div id="timeline-container">
        <div id="device-tracks-container"></div>
        
        <div class="timeline-aligner">
            <div class="timeline-aligner-spacer"></div>
            <div id="timeline-wrapper-content">
                <input type="range" id="timeline" min="0" max="86400" step="60" value="0">
                <div id="time-indicator"><div id="current-time">00:00</div></div>
                <div id="current-time-indicator"></div>
            </div>
        </div>
        
        <div class="timeline-aligner">
            <div class="timeline-aligner-spacer"></div>
            <div class="time-labels timeline-aligner-content">
                ${timeLabelsHtml}
            </div>
        </div>
      </div>

      <div class="controls">
        <button id="prevDayBtn">◀</button>
        <input type="text" id="date-picker" readonly="" style="width: 65px;font-size: 10px;background: #007bff;border: 1px solid #007bff;border-radius: 4px;padding: 4px 8px;height: 15px;cursor: pointer;">
        <button id="nextDayBtn">▶</button>
        <button id="todayBtn">此刻</button>
        <select id="speed">
          <option value="1">1x</option>
          <option value="5">5x</option>
          <option value="10">10x</option>
          <option value="30">30x</option>
        </select>
        <button id="playPauseBtn">播放</button>
      </div>

      <div id="event-tooltip">
        <strong id="tooltip-device-name"></strong>
        <ul id="tooltip-events-list"></ul>
      </div>
    `;
  }
}

customElements.define('device-replay-card', DeviceReplayCard);