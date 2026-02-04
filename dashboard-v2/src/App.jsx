import React, { useState } from 'react';

const App = () => {
  const [activeTab, setActiveTab] = useState('Overview');
  
  const tabs = ['Overview', 'Journals', 'Tasks', 'Activity'];
  
  const TabContent = ({ tabName }) => (
    <div className="p-8 bg-primary-dark/50 rounded-xl border border-primary-medium/30">
      <h2 className="text-2xl font-semibold text-white mb-4">{tabName} Dashboard</h2>
      <p className="text-gray-300">
        This is the {tabName.toLowerCase()} section. Content will appear here.
      </p>
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="bg-primary-dark p-4 rounded-lg border border-primary-medium/20">
            <div className="h-40 bg-primary-medium/20 rounded flex items-center justify-center">
              <span className="text-gray-400">{tabName} Card {item}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-primary-dark text-white">
      {/* Header */}
      <header className="bg-primary-dark border-b border-primary-medium/30">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between">
            <div className="flex items-center space-x-3 mb-4 md:mb-0">
              <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
                <span className="text-xl">🎛️</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold">Mission Control</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="hidden md:block text-gray-300">
                Status: <span className="text-accent font-medium">Operational</span>
              </div>
              <button className="px-4 py-2 bg-accent hover:bg-accent/90 rounded-lg font-medium transition-colors">
                Launch
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-primary-dark border-b border-primary-medium/30">
        <div className="container mx-auto px-4">
          <div className="flex space-x-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'text-accent border-b-2 border-accent bg-primary-medium/10'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-primary-medium/5'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <TabContent tabName={activeTab} />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-primary-medium/30 py-6">
        <div className="container mx-auto px-4 text-center text-gray-400">
          <p>Mission Control Dashboard v1.0 • All systems nominal</p>
        </div>
      </footer>
    </div>
  );
};

export default App;