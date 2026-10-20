<?php

namespace Sbm\SsoClient;

use Illuminate\Console\Command;

class LinkAccount extends Command
{
    protected $signature = 'sso:link {subject : Immutable portal user ID} {user : Existing local administrator user ID} {--remove : Remove this identity link}';

    protected $description = 'Explicitly link a SmartBusinessManager identity to an existing local administrator';

    public function handle(CentralSession $central): int
    {
        if (! $central->configured()) {
            $this->error('Configure SBM_SSO_* issuer, client, callback, application and branch values first.');

            return self::FAILURE;
        }
        $central->assertSafeUrl(config('sbm-sso.issuer'));
        $subject = (string) $this->argument('subject');
        if ($subject === '' || strlen($subject) > 255) {
            $this->error('Subject must contain 1 to 255 characters.');

            return self::FAILURE;
        }
        $identity = ['issuer' => config('sbm-sso.issuer'), 'subject' => $subject, 'application_id' => config('sbm-sso.application_id')];
        if ($this->option('remove')) {
            AccountLink::where($identity)->where('user_id', $this->argument('user'))->delete();
            $this->info('SSO account link removed.');

            return self::SUCCESS;
        }
        $link = new AccountLink([...$identity, 'branch_id' => config('sbm-sso.branch_id'), 'user_id' => (int) $this->argument('user'),
            'local_shop_id' => config('sbm-sso.local_shop_id') ?: null]);
        if (! $central->localUser($link)) {
            $this->error('Link requires an existing active local administrator and the explicitly configured local shop, if applicable.');

            return self::FAILURE;
        }
        $existing = AccountLink::where($identity)->first();
        if ($existing && $existing->user_id !== $link->user_id) {
            $this->error('Identity already links to another account. Remove it explicitly before replacing it.');

            return self::FAILURE;
        }
        AccountLink::updateOrCreate($identity, $link->getAttributes());
        $this->info('Linked portal subject '.$subject.' to local administrator '.$link->user_id.' for application '.$link->application_id.' / branch '.$link->branch_id.'.');

        return self::SUCCESS;
    }
}
