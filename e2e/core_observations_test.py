# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
import unittest
from core_observations import check_views


class CoreObservationChecks(unittest.TestCase):
    def fixture(self):
        entries = [{'type':'message','message':{'id':'call','payload':{'toolCalls':[{'id':'id','name':'write'}]}}},
                   {'type':'message','message':{'id':'result','payload':{'toolCallId':'id','name':'write','isError':False,
                     'observation':{'adapter':'builtin-write-v1','groupId':'call'},'output':{'details':{'path':'file','bytes':1}}}}}]
        record = {'kind':'file-write','sourceIds':['call','result'],'adapter':'builtin-write-v1','path':'file','bytes':1,'savedAtOperation':True}
        events = [{'type':'context.observations.prepared','data':{'view':{'records':[record]}}}]
        return entries, events

    def test_saved_operation_correspondence(self):
        self.assertEqual(check_views(*self.fixture())['status'],'pass')

    def test_missing_result_fails(self):
        entries, events = self.fixture()
        self.assertEqual(check_views(entries[:1],events)['status'],'fail')

    def test_invented_saved_path_fails(self):
        entries, events = self.fixture()
        events[0]['data']['view']['records'][0]['path']='invented'
        self.assertEqual(check_views(entries,events)['status'],'fail')

    def test_unexercised_is_not_success(self):
        self.assertEqual(check_views([],[])['status'],'not-exercised')


if __name__ == '__main__':
    unittest.main()
