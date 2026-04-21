import type { HotkeyKey } from '@/config/hotkeys';

export interface HotkeyEditorItem {
  label: string;
  keys: readonly HotkeyKey[];
}

export interface HotkeyEditorSection {
  title: string;
  blurb: string;
  items: readonly HotkeyEditorItem[];
}

export const HOTKEY_EDITOR_SECTIONS: readonly HotkeyEditorSection[] = [
  {
    title: '播放',
    blurb: '播放控制、逐帧操作与时间线跳转。',
    items: [
      { label: '播放/暂停', keys: ['PLAY_PAUSE'] },
      { label: '上一帧', keys: ['PREVIOUS_FRAME'] },
      { label: '下一帧', keys: ['NEXT_FRAME'] },
      { label: '跳到开头', keys: ['GO_TO_START'] },
      { label: '跳到末尾', keys: ['GO_TO_END'] },
      { label: '上一个吸附点', keys: ['PREVIOUS_SNAP_POINT'] },
      { label: '下一个吸附点', keys: ['NEXT_SNAP_POINT'] },
    ],
  },
  {
    title: '编辑',
    blurb: '片段编辑、删除流程与精确位移。',
    items: [
      { label: '在播放头处分割', keys: ['SPLIT_AT_PLAYHEAD', 'SPLIT_AT_PLAYHEAD_ALT'] },
      { label: '合并所选片段', keys: ['JOIN_ITEMS'] },
      { label: '删除所选项目', keys: ['DELETE_SELECTED', 'DELETE_SELECTED_ALT'] },
      { label: '波纹删除所选项目', keys: ['RIPPLE_DELETE', 'RIPPLE_DELETE_ALT'] },
      { label: '在播放头插入冻结帧', keys: ['FREEZE_FRAME'] },
      { label: '链接所选片段', keys: ['LINK_AUDIO_VIDEO'] },
      { label: '取消链接所选片段', keys: ['UNLINK_AUDIO_VIDEO'] },
      { label: '切换联动选择', keys: ['TOGGLE_LINKED_SELECTION'] },
      { label: '微移（1 像素）', keys: ['NUDGE_LEFT', 'NUDGE_RIGHT', 'NUDGE_UP', 'NUDGE_DOWN'] },
      { label: '微移（10 像素）', keys: ['NUDGE_LEFT_LARGE', 'NUDGE_RIGHT_LARGE', 'NUDGE_UP_LARGE', 'NUDGE_DOWN_LARGE'] },
    ],
  },
  {
    title: '工具',
    blurb: '时间线编辑工具切换。',
    items: [
      { label: '选择工具', keys: ['SELECTION_TOOL'] },
      { label: '修剪编辑工具', keys: ['TRIM_EDIT_TOOL'] },
      { label: '剃刀工具', keys: ['RAZOR_TOOL'] },
      { label: '在光标处分割', keys: ['SPLIT_AT_CURSOR'] },
      { label: '速率拉伸工具', keys: ['RATE_STRETCH_TOOL'] },
      { label: 'Slip 工具', keys: ['SLIP_TOOL'] },
      { label: 'Slide 工具', keys: ['SLIDE_TOOL'] },
    ],
  },
  {
    title: '历史与界面',
    blurb: '时间线历史、缩放和界面切换。',
    items: [
      { label: '撤销', keys: ['UNDO'] },
      { label: '重做', keys: ['REDO'] },
      { label: '时间线放大', keys: ['ZOOM_IN'] },
      { label: '时间线缩小', keys: ['ZOOM_OUT'] },
      { label: '缩放到适配全部内容', keys: ['ZOOM_TO_FIT'] },
      { label: '缩放到 100%', keys: ['ZOOM_TO_100', 'ZOOM_TO_100_ALT'] },
      { label: '切换吸附', keys: ['TOGGLE_SNAP'] },
      { label: '切换关键帧编辑器面板', keys: ['TOGGLE_KEYFRAME_EDITOR'] },
    ],
  },
  {
    title: '剪贴板',
    blurb: '复制、剪切、粘贴等跨编辑区通用命令。',
    items: [
      { label: '复制所选项目或关键帧', keys: ['COPY'] },
      { label: '剪切所选项目或关键帧', keys: ['CUT'] },
      { label: '粘贴项目或关键帧', keys: ['PASTE'] },
    ],
  },
  {
    title: '标记',
    blurb: '标记创建、删除与跳转。',
    items: [
      { label: '在播放头添加标记', keys: ['ADD_MARKER'] },
      { label: '删除所选标记', keys: ['REMOVE_MARKER'] },
      { label: '跳到上一个标记', keys: ['PREVIOUS_MARKER'] },
      { label: '跳到下一个标记', keys: ['NEXT_MARKER'] },
    ],
  },
  {
    title: '关键帧',
    blurb: '关键帧编辑器操作与视图切换。',
    items: [
      { label: '清除所选项目全部关键帧', keys: ['CLEAR_KEYFRAMES'] },
      { label: '切换关键帧编辑器到曲线视图', keys: ['KEYFRAME_EDITOR_GRAPH'] },
      { label: '切换关键帧编辑器到摄影表视图', keys: ['KEYFRAME_EDITOR_DOPESHEET'] },
    ],
  },
  {
    title: '源监视器',
    blurb: '入点/出点与插入/覆盖编辑。',
    items: [
      { label: '标记入点', keys: ['MARK_IN'] },
      { label: '标记出点', keys: ['MARK_OUT'] },
      { label: '清除入点/出点', keys: ['CLEAR_IN_OUT'] },
      { label: '插入编辑', keys: ['INSERT_EDIT'] },
      { label: '覆盖编辑', keys: ['OVERWRITE_EDIT'] },
    ],
  },
  {
    title: '项目',
    blurb: '保存与导出。',
    items: [
      { label: '保存项目', keys: ['SAVE'] },
      { label: '导出视频', keys: ['EXPORT'] },
    ],
  },
] as const;
