import unittest
from send_movie_push import eligible_movies, payload_for, send_notifications, allowed_endpoint, VAPID_SUBJECT

class PushTests(unittest.TestCase):
    def setUp(self):
        self.snapshot={'refreshedAt':'2026-10-07T13:00:00+08:00','movies':[
            {'id':'old','title':'Old','firstSeenAt':'2026-10-06T07:00:00+08:00'},
            {'id':'new','title':'New','firstSeenAt':'2026-10-07T07:00:00+08:00'}]}
        self.device={'id':'a'*64,'cursor':'2026-10-06T08:00:00+08:00','subscription':{'endpoint':'https://fcm.googleapis.com/test'}}

    def test_only_first_discoveries_after_subscription_and_before_snapshot(self):
        self.assertEqual([m['id'] for m in eligible_movies(self.snapshot,self.device['cursor'])],['new'])
        self.assertEqual(eligible_movies(self.snapshot,self.snapshot['refreshedAt']),[])
        self.assertIn('movie=new',payload_for([self.snapshot['movies'][1]])['url'])
        self.assertIn('new=new%2Cold',payload_for(self.snapshot['movies'])['url'])

    def test_ack_only_accepted_deliveries_and_retry_without_duplicates_after_ack(self):
        acks=[]
        self.assertEqual(send_notifications(self.snapshot,[self.device],lambda *_:201,acks.append),1)
        self.device['cursor']=acks[0]['cursor']
        self.assertEqual(send_notifications(self.snapshot,[self.device],lambda *_:self.fail('duplicate'),acks.append),0)

    def test_expired_subscriptions_removed_and_temporary_failures_retry(self):
        acks=[]
        self.assertEqual(send_notifications(self.snapshot,[self.device],lambda *_:410,acks.append),0)
        self.assertEqual(acks,[{'id':'a'*64,'expired':True}])
        acks=[]
        with self.assertRaises(RuntimeError):
            send_notifications(self.snapshot,[self.device],lambda *_:503,acks.append)
        self.assertEqual(acks,[])

    def test_test_notification_does_not_advance_real_movie_cursor(self):
        sent=[]
        self.assertEqual(send_notifications(None,[self.device],lambda s,p:sent.append(p) or 201,
                         lambda _:self.fail('test must not advance cursor'),'a'*64),1)
        self.assertTrue(sent[0]['test'])
        send_notifications(None,[self.device],lambda s,p:sent.append(p) or 201,
                           lambda _:self.fail('test must not advance cursor'),'a'*64)
        self.assertNotEqual(sent[0]['tag'],sent[1]['tag'])

    def test_one_failing_device_does_not_block_another(self):
        acks=[]
        devices=[self.device,{**self.device,'id':'b'*64}]
        statuses=iter([503,201])
        with self.assertRaises(RuntimeError):
            send_notifications(self.snapshot,devices,lambda *_:next(statuses),acks.append)
        self.assertEqual(acks,[{'id':'b'*64,'cursor':self.snapshot['refreshedAt']}])

    def test_rejects_arbitrary_internal_and_lookalike_push_endpoints(self):
        for endpoint in ('https://localhost/x','http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.example/x',
                         'https://u:p@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x'):
            self.assertFalse(allowed_endpoint(endpoint))
        for endpoint in ('https://fcm.googleapis.com/x','https://web.push.apple.com/x','https://updates.push.services.mozilla.com/x'):
            self.assertTrue(allowed_endpoint(endpoint))

    def test_vapid_signed_payload_decrypts_at_receiving_device(self):
        try:
            from pywebpush import webpush
            import http_ece
        except ImportError:
            self.skipTest('Install pywebpush==2.1.2 for encryption verification (required in CI)')
        import base64
        import json
        import os
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
        b64=lambda data:base64.urlsafe_b64encode(data).decode().rstrip('=')
        sender=ec.generate_private_key(ec.SECP256R1())
        receiver=ec.generate_private_key(ec.SECP256R1())
        auth=os.urandom(16)
        secret=b64(sender.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        subscription={'endpoint':'https://fcm.googleapis.com/encryption-test','keys':{
            'p256dh':b64(receiver.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)), 'auth':b64(auth)}}
        payload=payload_for([self.snapshot['movies'][1]])
        testcase=self
        class FakeSession:
            def post(self,url,**kwargs):
                testcase.assertEqual(url,subscription['endpoint'])
                testcase.assertTrue(kwargs['headers']['Authorization'].startswith('vapid '))
                clear=http_ece.decrypt(kwargs['data'],private_key=receiver,auth_secret=auth,version='aes128gcm')
                testcase.assertEqual(json.loads(clear),payload)
                return type('Response',(),{'status_code':201,'text':''})()
        result=webpush(subscription_info=subscription,data=json.dumps(payload),vapid_private_key=secret,
                       vapid_claims={'sub':VAPID_SUBJECT},requests_session=FakeSession())
        self.assertEqual(result.status_code,201)
