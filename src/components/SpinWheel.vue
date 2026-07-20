<template>
  <!-- v-show will not work, need to use style binding -->
  <Dropdown
    id="group-dropdown"
    :style="{ display: FocusMode ? 'none !important' : '' }"
    :model-value="GroupLabel"
    :options="GroupLabels"
    class="mt-4 z-1"
    @update:model-value="itemService?.changeGroupLabel"
    :pt="{
      input: {
        class: 'text-xl sm:text-2xl md:text-2xl'
      },
      item: {
        class: 'text-xl sm:text-xl md:text-xl'
      }
    }"
  />
  <ShareLink class="w-full flex justify-content-center z-1 mt-3" />
  <div ref="container" class="flex spin-container mt-3">
    <picture>
      <!--
      <source srcset="/img/image.avif" type="image/avif" />
      <source srcset="/img/image.webp" type="image/webp" />
      <img src="/img/image.png" class="image" alt="background image" />
      -->
      <img src="/img/daifuku_pointer.png" class="image" alt="background image" />
    </picture>
    <div
      class="icon"
      @click="spin"
      @keyup.enter="spin"
      @keyup.space="spin"
      v-tooltip.bottom="{
        value: `↻ Spin!`,
        class: 'text-xl',
        escape: true
      }"
      tabindex="0"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, inject, watch, nextTick } from 'vue';
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useToast } from 'primevue/usetoast';
import random from 'random';
import { Wheel, type WheelProps } from 'spin-wheel';
import { useDialog } from 'primevue/usedialog';
import { TickSound, LabelLength, DonateThreshold } from '@/services/SettingService';
import { GroupLabel, GroupLabels, ItemService, Items } from '@/services/ItemService';
import CongratulationDialog from '@/components/CongratulationDialog.vue';
import { FocusMode } from '@/services/SettingService';
import type { SpinRecordService, ISpinRecord } from '@/services/SpinRecordService';

const itemService = inject<ItemService>('ItemService');
const spinRecordService = inject<SpinRecordService>('SpinRecordService');
const uuid = inject<string | undefined>('uuid');

type SpinContext = Omit<ISpinRecord, 'id' | 'label' | 'timestamp'>;
const spinQueue: SpinContext[] = [];

const properties: WheelProps = {
  // debug: import.meta.env.DEV,
  isInteractive: false,
  radius: 0.48,
  rotationResistance: 0,
  itemLabelRadius: 0.92,
  itemLabelRadiusMax: 0.3,
  itemLabelRotation: 180,
  itemLabelAlign: 'left',
  itemLabelColors: ['#fff'],
  itemLabelBaselineOffset: -0.07,
  // Should also change app.scss
  itemLabelFont:
    '"Suez One", "Mochiy Pop P One", "Jua", "Unbounded", "Mitr", "Noto Sans TC", "Noto Sans SC", "Noto Sans Lao", "Noto Color Emoji"',
  itemLabelFontSizeMax: 55,
  itemBackgroundColors: [
    '#fdc963',
    '#00cca8',
    '#2b87e9',
    '#fd775b',
    '#ff4b78',
    '#c88857',
    '#a64a97',
    '#5b7c7d',
    '#715344',
    '#904e55',
    '#8b7856'
  ],
  rotationSpeedMax: 2000,
  lineWidth: 1,
  lineColor: '#fff',
  items: []
};

const container = ref();

let spinCount = 0;
let wheel: Wheel | undefined = undefined;
let supabaseClient: SupabaseClient | undefined = undefined;
let donationChannel: RealtimeChannel | undefined = undefined;

console.log('🚀 Script setup 已執行');

// ===== 抖內即時通知（Supabase Realtime）=====
// 舊版走自建 WebSocket（/donations/ws/{uuid}）；改為訂閱 Supabase Realtime 的 donations:{uuid}。
// uuid 由網址提供，是這台的存取秘密；同一個 app 分享給所有實況主，靠 uuid 區分。

const RESOLVE_URL_PREFIX = `https://neoripyon.leafwind.tw/donations/resolve`;

const connectDonationRealtime = async (uuid: string) => {
  console.log('🔌 正在啟用抖內監聽...\n📝 uuid：', uuid);

  // 1. 以 uuid 解析頻道名與 Supabase 設定（順便驗證 uuid；未知回 404）
  let config: { twitch_channel_name: string; supabase_url: string; supabase_anon_key: string };
  try {
    const res = await fetch(`${RESOLVE_URL_PREFIX}/${uuid}`);
    if (!res.ok) {
      console.error('❌ 無效的 uuid 或解析失敗:', res.status);
      toast.add({
        severity: 'error',
        summary: '監聽抖內啟用失敗',
        detail: '無效的專屬網址，請向 leafwind 確認',
        life: 10000
      });
      return;
    }
    config = await res.json();
  } catch (error) {
    console.error('❌ 解析 uuid 錯誤:', error);
    toast.add({
      severity: 'error',
      summary: '監聽抖內連線失敗',
      detail: '無法連線到伺服器，請稍後再試',
      life: 10000
    });
    return;
  }

  // 顯示頻道名 toast（取代舊 WebSocket 連上時的 connected 訊息）
  toast.add({
    severity: 'success',
    summary: '啟用監聽抖內模式',
    detail: `Twitch: ${config.twitch_channel_name || '未知'}`,
    life: 10000
  });

  // 2. 訂閱 Realtime 收抖內（supabase-js 自帶自動重連，不用手寫 retry）
  supabaseClient = createClient(config.supabase_url, config.supabase_anon_key);
  donationChannel = supabaseClient
    .channel(`donations:${uuid}`)
    .on('broadcast', { event: 'donation' }, (msg) => {
      console.log('📨 收到 Realtime 抖內:', msg.payload);
      handleDonation((msg.payload as { data: Parameters<typeof handleDonation>[0] }).data);
    })
    .subscribe((status) => {
      console.log('Realtime 訂閱狀態:', status);
    });
};

const handleDonation = (donationData: {
  donate_id: string;
  name: string;
  amount: number;
  message: string;
  timestamp: number;
  platform: string;
}) => {
  console.log('🎉 收到贊助:', donationData);

  // 顯示贊助訊息
  showDonationNotification(donationData);

  // 觸發轉盤（金額 / 門檻，無條件捨去）
  const spinCount = Math.floor(donationData.amount / DonateThreshold.value);
  for (let i = 1; i <= spinCount; i++) {
    spinQueue.push({
      donationTimestamp: donationData.timestamp,
      donorName: donationData.name,
      amount: donationData.amount,
      platform: donationData.platform,
      message: donationData.message,
      spinIndex: i,
      totalSpins: spinCount
    });
  }
  if (spinCount > 0) spin();
};

const showDonationNotification = (donationData: any) => {
  console.log(`💰 ${donationData.name} 從${donationData.platform}贊助了 $${donationData.amount}！`);
  console.log(`💬 留言: ${donationData.message}`);

  toast.add({
    severity: (donationData.amount >= DonateThreshold.value) ? 'success' : 'warn',
    summary: (donationData.amount >= DonateThreshold.value) ? '收到贊助！' : '收到贊助（未達門檻）',
    detail: `${donationData.name} 從${donationData.platform}贊助了 $${donationData.amount} 💬 ${donationData.message}`,
    life: 300000  // 5 分鐘後自動消失
  });
};

const stopAndClearSound = () => {
  if (!wheel) return;

  wheel.onCurrentIndexChange = () => {};
  wheel.stop();
};

const playSound = () => {
  if (!TickSound.value) return;

  var src = TickSound.value.value.startsWith('data:')
    ? TickSound.value.value
    : `/sound/${TickSound.value.value}`;
  const audio = new Audio(src);
  audio.volume = 0.3;
  audio.play();
};

const spin = () => {
  if (!wheel) return;

  wheel.onCurrentIndexChange = () => {
    if (!wheel) return;

    playSound();

    // Change rotation resistance based on current speed.
    // Provide a more entertaining performance.
    switch (true) {
      case wheel.rotationSpeed < 400:
        wheel.rotationResistance = -100;
        break;
      case wheel.rotationSpeed < 100:
        wheel.rotationResistance = -30;
        break;
      case wheel.rotationSpeed < 30:
        wheel.rotationResistance = -10;
        break;
    }
  };

  wheel.rotationResistance = -400;
  wheel.spin(wheel.rotationSpeed + random.int(1000, 1600));
};

const toast = useToast();
const dialog = useDialog();
const openCongratulationDialog = ($event: {
  type: 'rest';
  currentIndex: number;
  rotation: number;
}) => {
  const item = Items.value![$event.currentIndex];
  const context = spinQueue.shift();

  spinRecordService?.addRecord({
    timestamp: Date.now(),
    label: item.label,
    donorName: context?.donorName,
    amount: context?.amount,
    platform: context?.platform,
    message: context?.message,
    donationTimestamp: context?.donationTimestamp,
    spinIndex: context?.spinIndex,
    totalSpins: context?.totalSpins
  });

  dialog.open(CongratulationDialog, {
    props: {
      modal: true,
      showHeader: false,
      style: 'border: 0',
      contentStyle: 'border: 0; backgroundColor: transparent',
      dismissableMask: true
    },
    data: { item },
    onClose: () => {
      if (spinQueue.length > 0) spin();
    }
  });
};

onMounted(async () => {
  console.log('✅ onMounted 已執行');

  // 監聽 Items 變化
  watch(Items, (newValue) => (wheel!.items = newValue || []));
  watch(LabelLength, (newValue) => {
    wheel!.itemLabelRadiusMax = 1 - newValue;
  });

  // 初始化轉盤
  wheel = new Wheel(container.value, {
    ...properties,
    items: Items.value,
    itemLabelRadiusMax: 1 - LabelLength.value
  });

  wheel.spin(10);

  wheel.onRest = ($event) => {
    stopAndClearSound;
    openCongratulationDialog($event);
  };

  wheel.onSpin = () => {
    gtag('event', 'spin');
    gtag('event', 'spin_count', {
      count: ++spinCount
    });
  };

  // Workaround for itemLabelRadiusMax not working on first load.
  setTimeout(() => {
    wheel!.itemLabelRadiusMax = 1 - LabelLength.value;
  }, 50);

  // Add toast notification for UUID
  // Show toast after a small delay
  await nextTick();
  if (uuid) {
    // 啟用抖內監聽（也會 add toast）
    connectDonationRealtime(uuid);
  }
  else {
    // 無監聽抖內功能
    toast.add({
      severity: 'info',
      summary: '未啟用監聽抖內模式',
      detail: `請向 leafwind 索取專屬網址以啟用此功能`,
      life: 10000
    });
  }

});

onUnmounted(() => {
  // 清理 Realtime 訂閱
  if (donationChannel) {
    supabaseClient?.removeChannel(donationChannel);
    donationChannel = undefined;
  }
  supabaseClient = undefined;
});

// 暴露函數給父組件
defineExpose({
  handleDonation,
  spin
});
</script>

<style lang="scss" scoped>
@import 'primeflex/core/_variables.scss';

.spin-container {
  aspect-ratio: 1/1;
  width: 200vw;
  height: 90vh;

  margin-top: -3.5rem;
  margin-bottom: -10vh;
  position: relative;

  @media (min-width: map-get($breakpoints, 'sm')) {
    height: 100vh;
  }

  @media (min-width: map-get($breakpoints, 'md')) {
    height: 110vh;
  }
}

.image {
  object-position: center;
  object-fit: contain;

  aspect-ratio: 1/1;
  width: 200vw;
  height: 90vh;

  position: absolute;
  top: calc(calc(50%) - calc(90vh / 2));
  left: calc(calc(50%) - calc(200vw / 2));

  @media (min-width: map-get($breakpoints, 'sm')) {
    height: 100vh;
    top: calc(calc(50%) - calc(100vh / 2));
  }

  @media (min-width: map-get($breakpoints, 'md')) {
    height: 110vh;
    top: calc(calc(50%) - calc(110vh / 2));
  }
}

.button-container {
  margin-top: -5.5rem;

  button {
    z-index: 2;
    position: relative;

    $background-color: #0c0f1d;
    background: $background-color;

    &:hover {
      filter: brightness(1.3);
    }
  }
}

.icon {
  $icon-size: 13vh;
  cursor: pointer;

  width: $icon-size;
  height: $icon-size;
  border-radius: 50%;

  background-image: url(/img/icon.png);
  background-image: -webkit-image-set(
    url(/img/daifuku_maow.avif) type('image/avif'),
    url(/img/daifuku_maow.webp) type('image/webp'),
    url(/img/daifuku_maow.png) type('image/png')
  );
  background-image: image-set(
    url(/img/daifuku_maow.avif) type('image/avif'),
    url(/img/daifuku_maow.webp) type('image/webp'),
    url(/img/daifuku_maow.png) type('image/png')
  );

  background-size: contain;

  position: absolute;
  top: calc(calc(50%) - calc($icon-size / 2));
  left: calc(calc(50%) - calc($icon-size / 2));

  &:hover {
    filter: brightness(1.1);
  }
}
</style>
