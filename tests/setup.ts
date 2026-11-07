// The environment the server code expects, with values that exist only here.
//
// The Supabase URL and key are deliberately fake: every test stubs fetch, so a
// test that reaches the network is a test with a bug, and pointing at a real
// project would hide that by appearing to work.
process.env.SUPABASE_URL = 'https://test.supabase.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
process.env.VERIFY_ADMIN_KEY = 'test-staff-key';
process.env.NEXT_PUBLIC_SITE_ORIGIN = 'https://test.palma.invalid';
// Nothing should send mail from a test.
delete process.env.RESEND_API_KEY;
