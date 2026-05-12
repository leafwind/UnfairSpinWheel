import { ref } from 'vue';

export interface ISpinRecord {
  id: string;
  timestamp: number;
  label: string;
  donorName?: string;
  amount?: number;
  platform?: string;
  message?: string;
  donationTimestamp?: number;
  spinIndex?: number;
  totalSpins?: number;
}

const STORAGE_KEY = 'spin-records';

function loadFromStorage(): ISpinRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export const SpinRecords = ref<ISpinRecord[]>(loadFromStorage());

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SpinRecords.value));
}

export class SpinRecordService {
  addRecord(record: Omit<ISpinRecord, 'id'>) {
    SpinRecords.value.unshift({
      ...record,
      id: Date.now().toString()
    });
    saveToStorage();
  }

  clearRecords() {
    SpinRecords.value = [];
    saveToStorage();
  }

  exportTSV(): string {
    const headers = ['轉盤時間', '結果', '抖內者', '金額', '平台', '留言', '贊助時間', '次數'];
    const rows = SpinRecords.value.map((r) => [
      new Date(r.timestamp).toLocaleString('zh-TW'),
      r.label,
      r.donorName ?? '',
      r.amount?.toString() ?? '',
      r.platform ?? '',
      r.message ?? '',
      r.donationTimestamp ? new Date(r.donationTimestamp).toLocaleString('zh-TW') : '',
      r.spinIndex && r.totalSpins ? `${r.spinIndex}/${r.totalSpins}` : ''
    ]);
    return [headers, ...rows].map((row) => row.join('\t')).join('\n');
  }
}
