function StatCard({ label, value, icon, color }) {
  var gradients = {
    indigo: 'from-indigo-500 to-indigo-600',
    green:  'from-green-500 to-green-600',
    amber:  'from-amber-500 to-amber-600',
    red:    'from-red-500 to-red-600',
    blue:   'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    pink:   'from-pink-500 to-pink-600',
    gray:   'from-gray-500 to-gray-600',
  }

  return (
    <div className={"rounded-lg p-4 text-white bg-gradient-to-br " + (gradients[color] || gradients.indigo)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm opacity-80">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <span className="text-3xl opacity-70">{icon}</span>
      </div>
    </div>
  )
}

export default StatCard