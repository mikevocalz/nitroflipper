import unittest
from unittest.mock import patch
from types import SimpleNamespace

import frame_pace


class FramePaceTests(unittest.TestCase):
    def test_long_stall_is_kept_and_fails_despite_good_median(self):
        gaps = [16.7] * 40 + [600.0]
        frames = [0]
        for gap in gaps:
            frames.append(frames[-1] + int(gap * 1e6))
        measured = frame_pace.frame_gaps(frames)
        self.assertEqual(max(measured), 600)
        self.assertFalse(frame_pace.pacing_passes(measured, 16.7, 5, 50))

    def test_fifteen_percent_late_frames_is_not_smooth(self):
        self.assertFalse(frame_pace.pacing_passes([16.7] * 85 + [33.4] * 15, 16.7, 5, 50))
        self.assertTrue(frame_pace.pacing_passes([16.7] * 100, 16.7, 5, 50))
        self.assertFalse(frame_pace.pacing_passes([], 16.7, 5, 50))

    def test_duplicate_timestamps_are_not_zero_length_frames(self):
        self.assertEqual(frame_pace.frame_gaps([2_000_000, 1_000_000, 2_000_000]), [1.0])

    def test_reads_each_turn_and_excludes_history_and_inter_turn_idle(self):
        first = [100_000_000 + n * 16_700_000 for n in range(10)]
        second = [2_000_000_000 + n * 16_700_000 for n in range(10)]
        args = SimpleNamespace(layer='canvas', serial='device', package='test',
                               turns=2, tap='0.5,0.5', settle=1, min_frames=8,
                               max_missed_pct=5, max_gap_ms=50)
        samples = [(16.7, [1]), (16.7, [1] + first),
                   (16.7, first), (16.7, first + second)]
        with patch.object(frame_pace, 'present_times', side_effect=samples) as reads, \
             patch.object(frame_pace, 'window_frame', return_value=(100, 200, 400, 600)), \
             patch.object(frame_pace, 'adb') as adb, \
             patch.object(frame_pace.time, 'sleep'):
            self.assertEqual(frame_pace.run(args), 0)
            self.assertEqual(reads.call_count, 4)
            adb.assert_called_with('device', 'shell', 'input', 'tap', '300', '500')

    def test_one_frame_snap_cannot_pass(self):
        args = SimpleNamespace(layer='canvas', serial='device', package='test',
                               turns=1, tap='0.5,0.5', settle=1, min_frames=8,
                               max_missed_pct=5, max_gap_ms=50)
        with patch.object(frame_pace, 'present_times', side_effect=[(16.7, [1]), (16.7, [1, 2])]), \
             patch.object(frame_pace, 'window_frame', return_value=(0, 0, 400, 600)), \
             patch.object(frame_pace, 'adb'), patch.object(frame_pace.time, 'sleep'):
            self.assertEqual(frame_pace.run(args), 1)


if __name__ == '__main__':
    unittest.main()
