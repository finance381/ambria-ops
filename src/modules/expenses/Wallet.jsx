import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import WalletManager from './WalletManager'
import { goBack as navBack } from '../../lib/backNav'
import { hasPerm } from '../../lib/permissions'

function Wallet({ profile, inAdmin, onNavigateToExpenses }) {
  var [walletBalance, setWalletBalance] = useState(0)
  var [myWallet, setMyWallet] = useState(null)
  var [loading, setLoading] = useState(true)

  var isWalletAdmin = hasPerm(profile?.permsNew, 'finance.wallet.admin')
  var isAuditor = profile?.role === 'auditor'

  useEffect(function () {
    if (!profile?.id) return
    supabase.from('wallets').select('id, balance_paise, user_id').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        // A blocked or failed read landed here as 0 — the same answer a genuinely
        // empty wallet gives, so a session that could not see its own row showed
        // "0 pts" and looked correct. Shell was fixed for exactly this and says so
        // in its own comment; this copy never was.
        //
        // Still 0 for the UI, because WalletManager needs a number — but the
        // failure is now on the console instead of silently becoming a balance,
        // and myWallet stays null, which is what hides the My wallet entry rather
        // than offering a dashboard for a row we could not read.
        if (res.error) console.error('WALLET_FETCH_FAIL', res.error)
        else if (!res.data) console.warn('WALLET_MISSING for user', profile.id)
        setWalletBalance(res.data?.balance_paise || 0)
        setMyWallet(res.data || null)
        setLoading(false)
      })
  }, [profile?.id])

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  return (
    <WalletManager
      profile={profile}
      isAdmin={isWalletAdmin}
      isAuditor={isAuditor}
      myWallet={myWallet}
      walletBalance={walletBalance}
      onClose={function () { navBack() }}
      onBalanceChange={setWalletBalance}
      onNavigateToExpenses={onNavigateToExpenses}
      inAdmin={inAdmin}
    />
  )
}

export default Wallet