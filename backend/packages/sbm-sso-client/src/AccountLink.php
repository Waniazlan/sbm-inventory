<?php

namespace Sbm\SsoClient;

use Illuminate\Database\Eloquent\Model;

class AccountLink extends Model
{
    protected $table = 'sso_account_links';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['application_id' => 'integer', 'branch_id' => 'integer', 'user_id' => 'integer', 'local_shop_id' => 'integer'];
    }
}
