import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import WalletManager from './WalletManager'
import { goBack as navBack } from '../../lib/backNav'
import { hasPerm } from '../../lib/permissions'

function Wallet({ profile }) {
  var [walletBalance, setWalletBalance] = useState(0)
  var [myWallet, setMyWallet] = useState(null)
  var [loading, setLoading] = useState(true)

  var isWalletAdmin = profile?.role === 'admin' || hasPerm(profile?.permsNew, 'finance.wallet.admin')
  var isAuditor = profile?.role === 'auditor'

  useEffect(function () {
    if (!profile?.id) return
    supabase.from('wallets').select('id, balance_paise, user_id').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
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
    />
  )
}

export default Wallet